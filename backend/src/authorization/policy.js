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

// actor/target: user id strings (or ObjectIds — always .toString()'d before compare).
// action: one of Actions above.
// Returns { decision: 'ALLOW'|'DENY', reason?: string }.
const authorizeAction = async ({ actor, target, action }) => {
  if (!actor) return { decision: Decisions.DENY, reason: 'unauthenticated' };

  // Actions with no target (e.g. none currently) would skip straight to ALLOW here.
  if (!target) return { decision: Decisions.ALLOW };

  if (actor.toString() === target.toString()) {
    // Self-targeting is nonsensical for every action this policy currently
    // covers (message yourself via a "conversation", friend-request
    // yourself, block yourself) — deny uniformly rather than per-route.
    return { decision: Decisions.DENY, reason: 'self_target' };
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
  Actions, Decisions, authorizeAction, findRelationship, isBlocked,
};
