const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const store = require('../store');
const logger = require('../logger');

// Toggle mute for this conversation — see ConversationUserState.isMuted's
// model comment for the mute/hide distinction. Mirrors conversation-hide.js's
// shape (own-membership check, own-personal-room-only socket emit) but takes
// an explicit `muted` boolean rather than being one-directional, since mute
// is a toggle a user flips back and forth, not a one-way archive action.
module.exports = async (req, res) => {
  const { conversationId } = req.fields;
  const userID = req.user.id;

  if (!conversationId) {
    return res.status(400).json({ status: 'error' });
  }

  // express-formidable flattens multipart bodies to strings, but a JSON
  // body (what axios sends by default, e.g. muteConversation.js) comes
  // through with muted as a real boolean — accept either form rather than
  // assuming one (verified empirically: req.fields.muted was the actual
  // boolean `true` here, not the string "true").
  const muted = req.fields.muted === true || req.fields.muted === 'true';

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
      { $set: { isMuted: muted } },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err, userId: userID, conversationId }, 'Failed to update conversation mute state');
    return res.status(500).json({ status: 'error' });
  }

  logger.info({ userId: userID, conversationId, muted }, 'Conversation mute toggled');

  // Own personal room only — muting is private/unilateral, same as hide.
  store.io.to(userID.toString()).emit('conversation-muted', { conversationId, muted });

  res.status(200).json({ status: 'success', conversationId, isMuted: muted });
};
