const ConversationUserState = require('../models/ConversationUserState');
const logger = require('../logger');

// Clears a stale "deleted from inbox" tombstone when a user (re)joins a
// group — matches message.js's own un-delete-on-new-activity behavior for
// DMs (see its ConversationUserState.updateOne call). Without this, a user
// who once deleted a group conversation and later rejoins (direct add,
// invite link, or an approved join request) stays permanently invisible in
// list-rooms.js even though they're an active member again — the tombstone
// never gets cleared by anything else. deletedBefore is intentionally NOT
// cleared (same as message.js) — rejoining reveals the conversation again,
// not the pre-delete history.
const unhideConversationForUser = (conversationId, userId) => ConversationUserState.updateOne(
  { conversation: conversationId, user: userId, deletedAt: { $ne: null } },
  { $set: { deletedAt: null } },
).catch((err) => {
  logger.warn({ err, conversationId, userId }, 'Failed to clear conversation deletedAt on group join');
});

module.exports = unhideConversationForUser;
