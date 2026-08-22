const Relationship = require('../models/Relationship');

// Single source of truth for "can actor do this to/with target". Routes call
// authorizeAction() instead of hand-rolling their own relationship/block
// checks — see message.js, create-room.js, friend-requests/*.js. Extending
// to a new action (VIEW_SHARED_MEDIA, ADD_TO_GROUP, ...) means adding one
// case here, not re-deriving the same block/relationship lookup in a new route.
const Actions = {
  VIEW_PROFILE: 'VIEW_PROFILE',
  START_CONVERSATION: 'START_CONVERSATION',
  SEND_MESSAGE: 'SEND_MESSAGE',
  SEND_FRIEND_REQUEST: 'SEND_FRIEND_REQUEST',
  ACCEPT_FRIEND_REQUEST: 'ACCEPT_FRIEND_REQUEST',
  BLOCK_USER: 'BLOCK_USER',
};

const Decisions = {
  ALLOW: 'ALLOW',
  DENY: 'DENY',
};

// Looks up the single row (if any) between two users, in either direction —
// matches the {requester, recipient} unique-per-direction index.
const findRelationship = (userA, userB) => Relationship.findOne({
  $or: [
    { requester: userA, recipient: userB },
    { requester: userB, recipient: userA },
  ],
});

// Block always wins regardless of action — checked first, unconditionally,
// before any action-specific logic runs.
const isBlocked = (relationship) => !!relationship && relationship.status === 'blocked';

// "Privileged" = anything other than the default level. Deliberately NOT an
// allowlist of ['root', 'admin'] — a future role added to the User model is
// hidden from standard users automatically, with no code change required
// here. See DECISIONS.md for the admin-privacy-boundary threat model this
// backs.
const isPrivileged = (user) => !!(user && user.level && user.level !== 'standard');

// actor/target: user id strings (or ObjectIds — always .toString()'d before compare).
// action: one of Actions above.
// actorLevel/targetLevel: optional `level` strings of the corresponding User
// documents. Callers that already fetched the target user for another reason
// (discoveryEnabled checks, etc.) pass these through at zero extra query
// cost; omitting both skips the admin-boundary check entirely, so existing
// call sites that don't pass them are unaffected until explicitly wired in.
// Returns { decision: 'ALLOW'|'DENY', reason?: string }.
const authorizeAction = async ({
  actor, target, action, actorLevel, targetLevel,
}) => {
  if (!actor) return { decision: Decisions.DENY, reason: 'unauthenticated' };

  // Actions with no target (e.g. none currently) would skip straight to ALLOW here.
  if (!target) return { decision: Decisions.ALLOW };

  if (actor.toString() === target.toString()) {
    // Self-targeting is nonsensical for every action this policy currently
    // covers (message yourself via a "conversation", friend-request
    // yourself, block yourself) — deny uniformly rather than per-route.
    return { decision: Decisions.DENY, reason: 'self_target' };
  }

  // Admin privacy boundary — checked before relationship/block state, since
  // it must win unconditionally: a standard user must never reach a
  // privileged target regardless of any relationship between them. Every
  // call site maps this reason to the same generic "not found" response it
  // already uses elsewhere (never a distinguishable 403) — see
  // DECISIONS.md's anti-enumeration note.
  if (isPrivileged({ level: targetLevel }) && !isPrivileged({ level: actorLevel })) {
    return { decision: Decisions.DENY, reason: 'admin_boundary' };
  }

  const relationship = await findRelationship(actor, target);
  if (isBlocked(relationship)) {
    return { decision: Decisions.DENY, reason: 'blocked' };
  }

  switch (action) {
    case Actions.VIEW_PROFILE:
    case Actions.START_CONVERSATION:
    case Actions.SEND_MESSAGE:
    case Actions.SEND_FRIEND_REQUEST:
    case Actions.BLOCK_USER:
      // Messaging-first: none of these require an accepted relationship —
      // only "not blocked", already checked above. Discoverability
      // (discoveryEnabled) is checked separately by the routes that resolve
      // a target user in the first place (users/resolve.js, friend-requests/
      // send.js) since it's a lookup-time concern, not a per-action one.
      return { decision: Decisions.ALLOW };

    case Actions.ACCEPT_FRIEND_REQUEST:
      if (!relationship || relationship.status !== 'pending') {
        return { decision: Decisions.DENY, reason: 'no_pending_request' };
      }
      if (relationship.recipient.toString() !== actor.toString()) {
        return { decision: Decisions.DENY, reason: 'not_the_recipient' };
      }
      return { decision: Decisions.ALLOW };

    default:
      return { decision: Decisions.DENY, reason: 'unknown_action' };
  }
};

module.exports = {
  Actions, Decisions, authorizeAction, findRelationship, isBlocked, isPrivileged,
};
