const GroupMember = require('../models/GroupMember');
const Room = require('../models/Room');
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
  MEMBER: [Capabilities.SEND_MESSAGE, Capabilities.CREATE_INVITE],
};

// Single lookup every group route needs first. Returns null for a
// non-member, a soft-removed row, or a PENDING/LEFT/REMOVED/BANNED row —
// callers treat null as "404, not a distinguishable 403" to avoid leaking
// group existence to non-members. active and status are checked together
// (belt-and-suspenders — they always agree by construction, see
// GroupMember.js) rather than either one alone.
const getMembership = (groupId, userId) => GroupMember.findOne({
  group: groupId, user: userId, active: true, status: 'ACTIVE',
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
  isPrivileged,
};
