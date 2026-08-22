const Message = require('../models/Message');
const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const sanitizeDeletedMessage = require('../utils/sanitizeDeletedMessage');
const requireVisibleConversation = require('../utils/requireVisibleConversation');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const { hasValidVaultToken } = require('../vault/vaultToken');

module.exports = async (req, res, next) => {
  let { roomID, firstMessageID } = req.fields;

  // Pre-existing gap closed in passing: this route previously trusted
  // roomID with no membership check at all. Fetching the room here is also
  // what roomHasBoundaryViolation needs, so both checks share the one query.
  const room = await Room.findOne({ _id: roomID });
  if (!room) {
    return res.status(404).json({ error: true });
  }
  const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
  if (!isMember) {
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

  Message.find({ room: roomID, _id: { $lt: firstMessageID } })
    .sort({ _id: -1 })
    .limit(20)
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
      messages.reverse();
      res.status(200).json({
        messages: messages
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
