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
});

// list-rooms.js filters by people membership and sorts by lastUpdate — compound index
// covers both the filter and the sort in a single index scan.
RoomSchema.index({ people: 1, lastUpdate: -1 });

module.exports = User = mongoose.model('rooms', RoomSchema);
