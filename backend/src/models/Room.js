const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const RoomSchema = new Schema({
  people: [{ type: Schema.ObjectId, ref: 'users' }],
  title: String,
  picture: { type: Schema.ObjectId, ref: 'images' },
  isGroup: { type: Boolean, default: false },
  lastUpdate: Date,
  lastAuthor: { type: Schema.ObjectId, ref: 'users' },
  lastMessage: { type: Schema.ObjectId, ref: 'messages' },
  // Group-only fields (isGroup:true) — see DECISIONS.md D-035, "Group IS-A
  // Room". people stays the source of truth for list-rooms.js's indexed
  // query; GroupMember (backend/src/models/GroupMember.js) is the source of
  // truth for role/permission checks. ownerId is a denormalized cache of the
  // GroupMember with role:OWNER, kept in sync at creation/ownership-change
  // time, so list/get routes can render an owner badge without a query per row.
  description: { type: String, default: '' },
  ownerId: { type: Schema.ObjectId, ref: 'users' },
  privacy: { type: String, enum: ['PUBLIC', 'PRIVATE', 'INVITE_ONLY'], default: 'PRIVATE' },
  settings: { type: Schema.Types.Mixed, default: {} },
  disabledAt: { type: Date, default: null },
  // 1:1 DMs only (undefined for groups): the two participant ids sorted and
  // joined, e.g. "<lowerId>:<higherId>" — a canonical identity for the pair
  // so the unique index below is the actual race-safe protection against
  // create-room.js creating two DM rooms for the same two users under
  // concurrent "open chat" requests (findOne-then-save is not atomic).
  // No `default` — every group room leaves this path genuinely absent
  // (not null), which the partial index below requires to exclude them;
  // `sparse` alone isn't enough since Mongoose would otherwise materialize
  // an explicit `null` for every group. See create-room.js.
  dmKey: { type: String },
});

// list-rooms.js filters by people membership and sorts by lastUpdate — compound index
// covers both the filter and the sort in a single index scan.
RoomSchema.index({ people: 1, lastUpdate: -1 });
// Partial (not sparse): only documents where dmKey actually exists are
// indexed/constrained, so the many group rooms — which never set dmKey at
// all — never collide with each other on this index.
RoomSchema.index({ dmKey: 1 }, { unique: true, partialFilterExpression: { dmKey: { $exists: true } } });

module.exports = User = mongoose.model('rooms', RoomSchema);
