const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const ROLES = ['OWNER', 'ADMIN', 'MEMBER'];
const STATUSES = ['PENDING', 'ACTIVE', 'LEFT', 'REMOVED', 'BANNED'];

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
  updatedAt: { type: Date, default: Date.now },
});

GroupMemberSchema.index({ group: 1, user: 1 }, { unique: true });
GroupMemberSchema.index({ group: 1, role: 1 });
GroupMemberSchema.index({ user: 1, group: 1 });
GroupMemberSchema.index({ group: 1, status: 1 });

module.exports = mongoose.model('groupMembers', GroupMemberSchema);
