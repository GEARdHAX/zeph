const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const store = require('../store');
const logger = require('../logger');

module.exports = async (req, res) => {
  const { conversationId } = req.fields;
  const userID = req.user.id;

  if (!conversationId) {
    return res.status(400).json({ status: 'error' });
  }

  let room;
  try {
    room = await Room.findOne({ _id: conversationId });
  } catch (e) {
    return res.status(404).json({ status: 'error' });
  }
  if (!room) {
    return res.status(404).json({ status: 'error' });
  }

  const isMember = room.people.some((person) => person.toString() === userID.toString());
  if (!isMember) {
    return res.status(403).json({ status: 'error' });
  }

  // Per-user tombstone only — the Room document and every Message in it are
  // completely untouched. The other participant's copy, and the shared
  // message records both sides still rely on for ordering/replies, are
  // never affected. Idempotent: re-deleting an already-deleted conversation
  // just re-writes the same deletedAt, no special-casing needed.
  try {
    await ConversationUserState.findOneAndUpdate(
      { conversation: conversationId, user: userID },
      { $set: { deletedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err, userId: userID, conversationId }, 'Failed to delete conversation');
    return res.status(500).json({ status: 'error' });
  }

  logger.info({ userId: userID, conversationId }, 'Conversation deleted (per-user)');

  store.io.to(userID.toString()).emit('conversation-deleted', { conversationId });

  res.status(200).json({ status: 'success', conversationId });
};
