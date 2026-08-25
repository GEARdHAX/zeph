const Message = require('../models/Message');
const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const sanitizeDeletedMessage = require('../utils/sanitizeDeletedMessage');
const requireVisibleConversation = require('../utils/requireVisibleConversation');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const { hasValidVaultToken } = require('../vault/vaultToken');
const groupPolicy = require('../authorization/groupPolicy');

// Reconnect resync: returns messages added to a room after lastMessageID, newest-cursor-first
// like more-messages.js but inverted ($gt instead of $lt) since this fills a forward gap
// left by a dropped socket connection instead of paging backward through history.
module.exports = async (req, res, next) => {
  const { roomID, lastMessageID } = req.fields;

  if (!roomID) {
    return res.status(400).json({ error: true });
  }

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return res.status(404).json({ error: true });
  }

  if (!room || room.disabledAt) {
    return res.status(404).json({ error: true });
  }

  // A former group member (removed/banned/left) can still resync history
  // they already had access to — see canReadRoomHistory.
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

  // Admin privacy boundary — reconnect/resync must not be a side door back
  // into an admin DM. See DECISIONS.md.
  const boundaryViolation = await roomHasBoundaryViolation({
    room, callerID: req.user.id, callerLevel: req.user.level,
  });
  if (boundaryViolation) {
    return res.status(404).json({ error: true });
  }

  const query = lastMessageID ? { room: roomID, _id: { $gt: lastMessageID } } : { room: roomID };

  // Delete-history cutoff — see more-messages.js/ConversationUserState's
  // model comment. Reconnect/resync must not resurrect pre-delete history
  // either, same as a fresh open.
  const state = await ConversationUserState.findOne({ conversation: roomID, user: req.user.id }).select('deletedBefore');
  const deletedBefore = state && state.deletedBefore;

  Message.find(query)
    .sort({ _id: 1 })
    .limit(200)
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
      res.status(200).json({
        messages: messages
          // "Delete for me" must not resurrect on resync after a dropped
          // connection — a message this user deleted for themselves stays
          // gone from their own view regardless of which device/session asks.
          .filter((e) => !(e.deletedFor || []).some((id) => id.toString() === req.user.id.toString()))
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
    })
    .catch((err) => {
      res.status(500).json({ error: true });
    });
};
