const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Generic user-to-user relationship, not hard-coded to "friends" — the same
// shape (requester/recipient/status) is meant to extend to group invitations
// later (see DECISIONS.md, Add People feature) without a schema rewrite.
//
// The unique index below is on {requester, recipient} as an ordered pair, so
// there's at most one row per direction between any two users. Blocking
// reuses whatever row already exists between the two users (in whichever
// direction it was originally created) and overwrites its status to
// 'blocked' — `requester`/`recipient` keep their original meaning (who sent
// the original request), and `blockedBy` records who actually did the
// blocking, independent of that. The authorization policy
// (src/authorization/policy.js) always checks for a 'blocked' row between
// the two users first, in either direction, before looking at
// pending/accepted state, since a block must override every other status.
const RelationshipSchema = new Schema({
  requester: { type: Schema.ObjectId, ref: 'users' },
  recipient: { type: Schema.ObjectId, ref: 'users' },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'blocked'],
    default: 'pending',
  },
  blockedBy: { type: Schema.ObjectId, ref: 'users', default: null },
  createdAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
});

// Every route in this feature looks up "is there already a relationship
// between these two users" in one direction or the other — a compound index
// on both fields (queried as an $or of two directions) covers that lookup.
RelationshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
RelationshipSchema.index({ recipient: 1, status: 1 });

module.exports = Relationship = mongoose.model('relationships', RelationshipSchema);
