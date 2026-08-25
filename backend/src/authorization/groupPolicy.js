const GroupMember = require('../models/GroupMember');
const Room = require('../models/Room');
const User = require('../models/User');
const { isPrivileged } = require('./policy');

// Group-internal role/capability authorization — a different axis from
// policy.js's actor<->target relationship model (friendship/block/admin
// boundary between two people). This module composes isPrivileged() from
// policy.js for the admin-boundary invite gate rather than reimplementing
// it. See DECISIONS.md D-035.
const Roles = { OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER' };
const ROLE_RANK = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

const Capabilities = {
  SEND_MESSAGE: 'SEND_MESSAGE',
  ADD_MEMBER: 'ADD_MEMBER',
  REMOVE_MEMBER: 'REMOVE_MEMBER',
  // Deleting another member's message (moderator action). Deleting your own
  // message is always allowed regardless of capability — same as today,
  // handled by message-delete.js's author check.
  DELETE_MESSAGE: 'DELETE_MESSAGE',
  EDIT_GROUP: 'EDIT_GROUP',
  PIN_MESSAGE: 'PIN_MESSAGE',
  MANAGE_ADMINS: 'MANAGE_ADMINS',
  CREATE_INVITE: 'CREATE_INVITE',
  APPROVE_REQUESTS: 'APPROVE_REQUESTS',
  BAN_MEMBER: 'BAN_MEMBER',
};

// Minimum capability set per role — no per-member overrides wired in yet
// (GroupMember.permissions exists for that future, unused today).
const ROLE_CAPABILITIES = {
  OWNER: Object.values(Capabilities),
  ADMIN: [
    Capabilities.SEND_MESSAGE, Capabilities.ADD_MEMBER, Capabilities.REMOVE_MEMBER,
    Capabilities.DELETE_MESSAGE, Capabilities.PIN_MESSAGE, Capabilities.CREATE_INVITE,
    Capabilities.APPROVE_REQUESTS, Capabilities.BAN_MEMBER,
  ],
  // ADD_MEMBER is deliberately open to every role (not just ADMIN/OWNER) —
  // "anyone can invite their friend" is the product intent, same trust
  // level as CREATE_INVITE already had. members-add.js's other checks
  // (target exists, admin-boundary, not banned) are unaffected by this.
  MEMBER: [Capabilities.SEND_MESSAGE, Capabilities.CREATE_INVITE, Capabilities.ADD_MEMBER],
};

// Single lookup every group route needs first. Returns null for a
// non-member, a soft-removed row, or a PENDING/LEFT/REMOVED/BANNED row —
// callers treat null as "404, not a distinguishable 403" to avoid leaking
// group existence to non-members. active and status are checked together
// (belt-and-suspenders — they always agree by construction for every row
// written since D-037) rather than either one alone.
//
// status is matched as ACTIVE-or-unset ($in with null covers both a
// genuinely absent field and an explicit null), NOT status:'ACTIVE' alone —
// every GroupMember row written before D-037 (this field's introduction)
// has active:true but no status field persisted at all; a strict equality
// filter here 404s every one of those real, valid memberships. See
// scripts/backfillGroupMemberStatus.js (run once to fix existing data) and
// DECISIONS.md. This tolerance is defense-in-depth for any environment
// where that backfill hasn't been run — not a substitute for running it.
const getMembership = (groupId, userId) => GroupMember.findOne({
  group: groupId, user: userId, active: true, status: { $in: ['ACTIVE', null] },
});

// Falls back to Room.people for a group that has zero GroupMember rows at
// all (predates the Groups feature and hasn't gone through init.js's
// boot-time backfill yet, or a direct-Mongo test fixture) — treats every
// person in Room.people as an implicit MEMBER so legacy groups don't become
// completely unusable. Once a group has ANY real GroupMember row, this
// stops falling back and GroupMember becomes exclusively authoritative for
// it — the fallback is for "never touched this system," not a permanent
// bypass. See DECISIONS.md D-035.
const getMembershipWithFallback = async (groupId, userId) => {
  const membership = await getMembership(groupId, userId);
  if (membership) return membership;

  const anyMembership = await GroupMember.exists({ group: groupId });
  if (anyMembership) return null;

  const room = await Room.findOne({ _id: groupId, isGroup: true }).select('people');
  const isLegacyMember = !!room && room.people.some((p) => p.toString() === userId.toString());
  return isLegacyMember ? {
    role: Roles.MEMBER, status: 'ACTIVE', user: userId, group: groupId,
  } : null;
};

const hasCapability = (role, capability) => (ROLE_CAPABILITIES[role] || []).includes(capability);

// Role-change rules (promote/demote via members-role.js):
// - Ownership is never assigned through a role update (single dedicated
//   transfer action, not built this pass — a group has exactly one owner,
//   set at creation).
// - Only OWNER holds MANAGE_ADMINS — an ADMIN cannot promote/demote anyone.
// - The OWNER's own row can't be demoted via this path.
const canChangeRole = ({ actorRole, targetRole, newRole }) => {
  if (newRole === Roles.OWNER) return false;
  if (actorRole !== Roles.OWNER) return false;
  if (targetRole === Roles.OWNER) return false;
  return true;
};

// Removal rules (members-remove.js / remove-room.js's group branch):
// - The OWNER can't be removed via this path (must transfer ownership or
//   delete the group).
// - OWNER can remove ADMIN or MEMBER; ADMIN can only remove MEMBER; MEMBER
//   can't remove anyone (self-removal is the separate `leave` route).
const canRemoveMember = ({ actorRole, targetRole }) => {
  if (targetRole === Roles.OWNER) return false;
  if (actorRole === Roles.OWNER) return true;
  if (actorRole === Roles.ADMIN) return targetRole === Roles.MEMBER;
  return false;
};

// A BANNED row (any group, if it exists) must block every rejoin path
// (join-request, invite link) regardless of how the row got there — never
// silently reactivate a ban by upserting over it.
const isBanned = async (groupId, userId) => {
  const row = await GroupMember.findOne({ group: groupId, user: userId, status: 'BANNED' }).select('_id');
  return !!row;
};

// Any GroupMember row at all (regardless of status) — used to let a
// removed/banned/left former member still locally hide the now-
// inaccessible conversation from their own inbox (conversation-delete.js),
// which getMembership() alone can't authorize since it excludes exactly
// those statuses by design.
const wasEverMember = async (groupId, userId) => {
  const row = await GroupMember.findOne({ group: groupId, user: userId }).select('_id');
  return !!row;
};

// Read access to a group's message history: current Room.people membership
// (the normal case, and the only case for a 1:1 DM — `room` is passed in so
// callers don't re-fetch it) OR a former member (REMOVED/BANNED/LEFT) —
// matches WhatsApp/Telegram letting a removed member keep their existing
// scrollback instead of the conversation vanishing outright on next refresh.
// Sending is still blocked separately (BottomBar's accessRevoked gate on the
// frontend; these read routes never accept a POST). See DECISIONS.md.
const canReadRoomHistory = async (room, userId) => {
  const isCurrentMember = room.people.some((p) => p.toString() === userId.toString());
  if (isCurrentMember) return true;
  if (!room.isGroup) return false;
  return wasEverMember(room._id, userId);
};

// Reconstructs the same {reason, actorName} shape BottomBar.jsx expects
// from the live 'group:member:removed' socket event (see io.js's
// ROOM_ACCESS_REVOKED case) — used by every route that returns a room to a
// possibly-former member (get-room.js, join-room.js) so the composer stays
// gated after a fresh page load, not only while the live socket event is
// still in memory. Returns undefined when there's nothing to report (a
// current member, a 1:1 room, or a LEFT/never-removed row).
const getAccessRevokedInfo = async (room, userId, isCurrentMember) => {
  if (!room.isGroup || isCurrentMember) return undefined;
  const formerMembership = await GroupMember.findOne({ group: room._id, user: userId })
    .select('status removedBy').lean();
  if (!formerMembership || !['REMOVED', 'BANNED'].includes(formerMembership.status)) return undefined;

  const remover = formerMembership.removedBy
    ? await User.findById(formerMembership.removedBy).select('firstName lastName username').lean()
    : null;
  const actorName = remover
    ? `${remover.firstName || ''} ${remover.lastName || ''}`.trim() || remover.username
    : null;
  return { reason: formerMembership.status === 'BANNED' ? 'banned' : 'removed', actorName };
};

// { method, inviterName } for the CURRENT caller's own membership — lets the
// frontend show "You joined via invite link, invited by Y" as the empty-
// state message when this member's visible history is empty (their own
// join system-message can fall before their own ConversationUserState.
// deletedBefore cutoff after a delete-then-rejoin cycle — see
// unhideConversationForUser.js — hiding it along with everything else).
// Returns undefined for a 1:1 room or a member with no GroupMember row at
// all (legacy/fallback membership, see getMembershipWithFallback).
const getJoinInfo = async (room, userId) => {
  if (!room.isGroup) return undefined;
  const membership = await GroupMember.findOne({ group: room._id, user: userId })
    .select('joinedVia invitedBy').lean();
  if (!membership) return undefined;

  const inviter = membership.invitedBy
    ? await User.findById(membership.invitedBy).select('firstName lastName username').lean()
    : null;
  const inviterName = inviter
    ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.username
    : null;
  return { method: membership.joinedVia || 'ADDED', inviterName };
};

module.exports = {
  Roles,
  ROLE_RANK,
  Capabilities,
  ROLE_CAPABILITIES,
  getMembership,
  getMembershipWithFallback,
  hasCapability,
  canChangeRole,
  canRemoveMember,
  isBanned,
  wasEverMember,
  canReadRoomHistory,
  getAccessRevokedInfo,
  getJoinInfo,
  isPrivileged,
};
