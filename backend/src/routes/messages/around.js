const Message = require('../../models/Message');
const Room = require('../../models/Room');
const ConversationUserState = require('../../models/ConversationUserState');
const sanitizeDeletedMessage = require('../../utils/sanitizeDeletedMessage');
const requireVisibleConversation = require('../../utils/requireVisibleConversation');
const roomHasBoundaryViolation = require('../../utils/roomHasBoundaryViolation');
const groupPolicy = require('../../authorization/groupPolicy');
const { hasValidVaultToken } = require('../../vault/vaultToken');

const HALF_WINDOW = 15;

// "Jump to this message" — POST /api/messages/around { roomID, messageID }.
// Returns a window of messages centered on messageID (up to HALF_WINDOW on
// each side) so the frontend can seed Messages.jsx's list and scroll
// straight to it, without paging through everything in between via
// messages/more.js one page at a time. Same authorization gates as
// more-messages.js (membership, admin-privacy boundary, vault lock,
// delete-history cutoff) — a search hit must never expose more than a
// normal history page already would.
module.exports = async (req, res) => {
  try {
    await handleAround(req, res);
  } catch (err) {
    res.status(500).json({ error: true });
  }
};

const handleAround = async (req, res) => {
  const { roomID, messageID } = req.fields;
  if (!roomID || !messageID) {
    return res.status(400).json({ error: true });
  }

  const room = await Room.findOne({ _id: roomID });
  if (!room || room.disabledAt) {
    return res.status(404).json({ error: true });
  }
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

  const boundaryViolation = await roomHasBoundaryViolation({
    room,
    callerID: req.user.id,
    callerLevel: req.user.level,
  });
  if (boundaryViolation) {
    return res.status(404).json({ error: true });
  }

  const target = await Message.findOne({ _id: messageID, room: roomID }).select('_id date');
  if (!target) {
    return res.status(404).json({ error: true });
  }

  const state = await ConversationUserState.findOne({ conversation: roomID, user: req.user.id }).select(
    'deletedBefore',
  );
  const deletedBefore = state && state.deletedBefore;

  const populated = (query) =>
    query
      .populate({
        path: 'author',
        select: '-email -password -friends -__v -vaultPinHash',
        populate: { path: 'picture' },
      })
      .populate([{ path: 'file', strictPopulate: false }])
      .populate([{ path: 'media', strictPopulate: false }])
      .lean();

  const [before, after] = await Promise.all([
    populated(
      Message.find({ room: roomID, _id: { $lte: target._id } })
        .sort({ _id: -1 })
        .limit(HALF_WINDOW + 1),
    ),
    populated(
      Message.find({ room: roomID, _id: { $gt: target._id } })
        .sort({ _id: 1 })
        .limit(HALF_WINDOW),
    ),
  ]);

  const combined = [...before.reverse(), ...after];
  const hasMoreBefore = before.length > HALF_WINDOW;
  const hasMoreAfter = after.length === HALF_WINDOW;
  // before[] over-fetches by one (>=) to detect hasMoreBefore the same way
  // more-messages.js does — drop that extra row now that it's served its purpose.
  const page = hasMoreBefore ? combined.slice(1) : combined;

  res.status(200).json({
    hasMoreBefore,
    hasMoreAfter,
    messages: page
      .filter((e) => !(e.deletedFor || []).some((uid) => uid.toString() === req.user.id.toString()))
      .filter((e) => !deletedBefore || new Date(e.date) > deletedBefore)
      .map((e) => {
        const message = sanitizeDeletedMessage(e);
        if (message.author) return message;
        return { ...message, author: { firstName: 'Deleted', lastName: 'User' } };
      }),
  });
};
