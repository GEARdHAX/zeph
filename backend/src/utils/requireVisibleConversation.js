const ConversationUserState = require('../models/ConversationUserState');

// Shared gate for every route that reads an existing room's contents
// (join-room, get-room, more-messages, sync-messages). Each of those routes
// calls this independently and re-checks it themselves — none of them may
// assume a sibling route already enforced it, since a vault token expires
// (10 min) well before a room typically stops being polled/paginated.
//
// deletedAt is intentionally NOT a 404 gate here. It only ever reflects the
// REQUESTING user's own "Delete DM" action on their own state row — there is
// no other-user/IDOR scenario it protects against, since a user can never be
// blocked by anyone's delete but their own. Blocking a deleter's own
// re-access to a room they're still a member of served no security purpose
// and just broke "delete, then reopen the room, then message" — deleting a
// conversation removes it from the inbox LIST only, exactly like hiding
// does; direct access (deep link, still-open tab, sending a message) is
// unaffected. Opening a deleted room's messages doesn't auto-restore inbox
// visibility (only a new message does, in message.js) — a plain read is
// not "using" the conversation the way replying is.
//
// Returns:
//   { ok: true }                          - visible, proceed normally
//   { ok: false, status: 403, reason }    - hidden, but no valid vault token on this request
const requireVisibleConversation = async ({ roomID, userID, hasVaultAuth }) => {
  const state = await ConversationUserState.findOne({ conversation: roomID, user: userID });
  if (!state) return { ok: true };

  if (state.isHidden && !hasVaultAuth) {
    return { ok: false, status: 403, reason: 'vault_locked' };
  }

  return { ok: true };
};

module.exports = requireVisibleConversation;
