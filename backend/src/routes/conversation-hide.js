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

  // Upsert keeps this idempotent by construction — hiding an already-hidden
  // conversation just re-writes the same isHidden:true, no special-casing.
  try {
    await ConversationUserState.findOneAndUpdate(
      { conversation: conversationId, user: userID },
      { $set: { isHidden: true, hiddenAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err, userId: userID, conversationId }, 'Failed to hide conversation');
    return res.status(500).json({ status: 'error' });
  }

  logger.info({ userId: userID, conversationId }, 'Conversation hidden');

  // Own personal room only — hiding is private/unilateral, the other
  // participant's devices must never learn this happened (same reasoning as
  // message-delete's "delete for me" branch).
  store.io.to(userID.toString()).emit('conversation-hidden', { conversationId });

  res.status(200).json({ status: 'success', conversationId, isHidden: true });
};
