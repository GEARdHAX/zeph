const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const store = require('../store');
const logger = require('../logger');

// Explicit counterpart to conversation-delete.js's tombstone — clears
// deletedAt the same way message.js's reappearance logic does when a new
// message arrives, but as a direct user action instead of waiting on
// someone else to post first. deletedBefore is intentionally left alone
// (same reasoning as message.js): restoring must only reveal NEW activity
// from this point forward, never resurrect the pre-delete history. See
// ConversationUserState's model comment and DECISIONS.md.
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
  if (!room || room.disabledAt) {
    return res.status(404).json({ status: 'error' });
  }

  // Same membership check as conversation-delete.js — a former group
  // member (removed/banned/left) can still see their own removed-list
  // entry (they had it hidden, not deleted-then-forgotten), but restoring
  // it wouldn't give them any actual access back (get-room.js/join-room.js
  // independently re-check real membership), so this only needs to allow
  // CURRENT members to restore. wasEverMember isn't checked here on
  // purpose: restoring is only meaningful for someone who could still open
  // the conversation afterward.
  const isMember = room.people.some((person) => person.toString() === userID.toString());
  if (!isMember) {
    return res.status(403).json({ status: 'error' });
  }

  try {
    await ConversationUserState.findOneAndUpdate(
      { conversation: conversationId, user: userID },
      { $set: { deletedAt: null } },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err, userId: userID, conversationId }, 'Failed to restore conversation');
    return res.status(500).json({ status: 'error' });
  }

  logger.info({ userId: userID, conversationId }, 'Conversation restored (per-user)');

  store.io.to(userID.toString()).emit('conversation-unhidden', { conversationId });

  res.status(200).json({ status: 'success', conversationId });
};
