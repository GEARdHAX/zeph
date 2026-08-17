const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const store = require('../store');
const logger = require('../logger');
const { requireVaultAuth } = require('../vault/vaultToken');

const handler = async (req, res) => {
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

  try {
    await ConversationUserState.findOneAndUpdate(
      { conversation: conversationId, user: userID },
      { $set: { isHidden: false, hiddenAt: null } },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err, userId: userID, conversationId }, 'Failed to unhide conversation');
    return res.status(500).json({ status: 'error' });
  }

  logger.info({ userId: userID, conversationId }, 'Conversation unhidden');

  store.io.to(userID.toString()).emit('conversation-unhidden', { conversationId });

  res.status(200).json({ status: 'success', conversationId, isHidden: false });
};

// Requiring a valid vault token to unhide (not just the main JWT) means you
// can't unhide something you shouldn't yet be able to see in the first
// place — the vault gate applies symmetrically to both "view" and "restore."
module.exports = [requireVaultAuth, handler];
