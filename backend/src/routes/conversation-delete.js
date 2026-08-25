const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const groupPolicy = require('../authorization/groupPolicy');
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

  // A removed/banned/left former group member is no longer in room.people,
  // but still needs to be able to locally hide the now-inaccessible
  // conversation from their own inbox — otherwise it sits there forever
  // with no way to remove it. groupPolicy.wasEverMember() checks for ANY
  // GroupMember row regardless of status, unlike getMembership()/
  // isMember below which both correctly exclude ex-members from every
  // other group operation. DM behavior (the room.people check) is
  // completely unchanged. See DECISIONS.md.
  const isMember = room.people.some((person) => person.toString() === userID.toString());
  if (!isMember) {
    const wasGroupMember = room.isGroup && await groupPolicy.wasEverMember(room._id, userID);
    if (!wasGroupMember) {
      return res.status(403).json({ status: 'error' });
    }
  }

  // Per-user tombstone only — the Room document and every Message in it are
  // completely untouched. The other participant's copy, and the shared
  // message records both sides still rely on for ordering/replies, are
  // never affected. Idempotent: re-deleting an already-deleted conversation
  // just re-writes the same deletedAt/deletedBefore, no special-casing
  // needed. deletedBefore is the history cutoff (see model comment) — a
  // later restore-by-new-activity clears deletedAt but never this, so old
  // messages stay hidden from this user even once the conversation
  // reappears in their inbox. See DECISIONS.md.
  const now = new Date();
  try {
    await ConversationUserState.findOneAndUpdate(
      { conversation: conversationId, user: userID },
      { $set: { deletedAt: now, deletedBefore: now } },
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
