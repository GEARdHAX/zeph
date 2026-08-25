const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const ROLES = ['OWNER', 'ADMIN', 'MEMBER'];
const STATUSES = ['PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'BANNED'];
const JOIN_METHODS = ['CREATED', 'ADDED', 'INVITE_LINK', 'JOIN_REQUEST'];

// Membership/role source of truth for isGroup:true rooms (Room._id doubles
// as groupId — see DECISIONS.md D-035, "Group IS-A Room"). Room.people stays
// a denormalized cache of active member ids for the existing list-rooms.js
// query; every authorization decision reads this collection instead.
//
// Soft-removal (active:false) rather than a hard delete on removal/leave —
// keeps the unique index meaningful across re-adds (re-joining is an
// upsert, not a race with a deleted row) and preserves moderation history
// without a second collection. Every query filters active:true explicitly.
//
// `status` is additive on top of `active` (not a replacement) — the ~8
// existing routes that already filter/set `active:true/false` keep working
// unchanged. Every route this field was introduced for (join-requests,
// ban) sets both fields together so they never disagree: active is always
// exactly (status === 'ACTIVE'). See DECISIONS.md.
const GroupMemberSchema = new Schema({
  group: { type: Schema.ObjectId, ref: 'rooms', required: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  role: { type: String, enum: ROLES, default: 'MEMBER' },
  status: { type: String, enum: STATUSES, default: 'ACTIVE' },
  // Per-member capability override bag — unused today (role hierarchy alone
  // covers the required capability set), exists so future overrides don't
  // need a schema migration.
  permissions: { type: Schema.Types.Mixed, default: {} },
  joinedAt: { type: Date, default: Date.now },
  mutedUntil: { type: Date, default: null },
  active: { type: Boolean, default: true },
  // Set only on REMOVED/BANNED (by members-remove.js / members-ban.js) — lets
  // get-room.js reconstruct the accessRevoked banner/composer-gate for a
  // former member reopening the room after a fresh page load, when the
  // live 'group:member:removed' socket event (the only other source of this
  // info) is long gone. Left as null for every other status.
  removedBy: { type: Schema.ObjectId, ref: 'users', default: null },
  // How this member first entered the group and who's credited for it —
  // 'CREATED' for the group creator (no inviter), 'ADDED' for a direct
  // members-add.js add, 'INVITE_LINK' for group/invites/join.js,
  // 'JOIN_REQUEST' for an approved join-requests/approve.js. Surfaced by
  // get-room.js/join-room.js so the frontend can show "You joined via X,
  // invited by Y" as the empty-state message instead of a generic "No
  // messages here yet" when this member's visible history is empty (their
  // own join system-message can fall before their ConversationUserState.
  // deletedBefore cutoff after a delete-then-rejoin cycle, hiding it along
  // with everything else). Set once at creation, never updated on re-add —
  // a re-add after removal keeps showing how they ORIGINALLY joined.
  joinedVia: { type: String, enum: JOIN_METHODS, default: 'ADDED' },
  invitedBy: { type: Schema.ObjectId, ref: 'users', default: null },
  updatedAt: { type: Date, default: Date.now },
});

GroupMemberSchema.index({ group: 1, user: 1 }, { unique: true });
GroupMemberSchema.index({ group: 1, role: 1 });
GroupMemberSchema.index({ user: 1, group: 1 });
GroupMemberSchema.index({ group: 1, status: 1 });

module.exports = mongoose.model('groupMembers', GroupMemberSchema);
module.exports.JOIN_METHODS = JOIN_METHODS;
