const Message = require('../models/Message');
const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const sanitizeDeletedMessage = require('../utils/sanitizeDeletedMessage');
const requireVisibleConversation = require('../utils/requireVisibleConversation');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const { hasValidVaultToken } = require('../vault/vaultToken');
const groupPolicy = require('../authorization/groupPolicy');

module.exports = async (req, res, next) => {
  let { roomID, firstMessageID } = req.fields;

  // Pre-existing gap closed in passing: this route previously trusted
  // roomID with no membership check at all. Fetching the room here is also
  // what roomHasBoundaryViolation needs, so both checks share the one query.
  const room = await Room.findOne({ _id: roomID });
  if (!room || room.disabledAt) {
    return res.status(404).json({ error: true });
  }
  // A former group member (removed/banned/left) can still page through
  // history they already had access to — see canReadRoomHistory.
  const canRead = await groupPolicy.canReadRoomHistory(room, req.user.id);
  if (!canRead) {
    return res.status(403).json({ error: true });
  }

  const visibility = await requireVisibleConversation({
    roomID,
    userID: req.user.id,
    hasVaultAuth: hasValidVaultToken(req),
  });
  if (!visibility.ok) {
    return res.status(visibility.status).json({ error: true, reason: visibility.reason });
  }

  // Admin privacy boundary — see DECISIONS.md.
  const boundaryViolation = await roomHasBoundaryViolation({
    room, callerID: req.user.id, callerLevel: req.user.level,
  });
  if (boundaryViolation) {
    return res.status(404).json({ error: true });
  }

  // Delete-history cutoff — a restored (delete-then-new-activity)
  // conversation only shows messages from this point forward for THIS
  // user; the other participant's view/the DB record are unaffected. See
  // ConversationUserState's model comment and DECISIONS.md.
  const state = await ConversationUserState.findOne({ conversation: roomID, user: req.user.id }).select('deletedBefore');
  const deletedBefore = state && state.deletedBefore;

  const PAGE_SIZE = 20;

  Message.find({ room: roomID, _id: { $lt: firstMessageID } })
    .sort({ _id: -1 })
    // Fetch one extra beyond the page — its presence (not a second query)
    // is how hasMore is determined, so the DB still does the limiting.
    .limit(PAGE_SIZE + 1)
    .populate({
      path: 'author',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: {
        path: 'picture',
      },
    })
    .populate([{ path: 'file', strictPopulate: false }])
    .populate([{ path: 'media', strictPopulate: false }])
    .lean()
    .then((messages) => {
      const hasMore = messages.length > PAGE_SIZE;
      const page = hasMore ? messages.slice(0, PAGE_SIZE) : messages;
      page.reverse();
      res.status(200).json({
        hasMore,
        messages: page
          .filter((e) => !(e.deletedFor || []).some((uid) => uid.toString() === req.user.id.toString()))
          .filter((e) => !deletedBefore || new Date(e.date) > deletedBefore)
          .map((e) => {
            const message = sanitizeDeletedMessage(e);
            if (message.author) {
              return message;
            } else {
              return {
                ...message,
                author: {
                  firstName: 'Deleted',
                  lastName: 'User',
                },
              };
            }
          }),
      });
    });
};
