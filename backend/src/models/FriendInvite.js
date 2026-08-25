const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// A shareable/QR-encodable link that creates a Relationship on acceptance —
// distinct from Relationship's request/accept flow (friend-requests/*.js),
// which targets a known recipient. Only tokenHash (sha256 of the raw token)
// is ever stored; the raw token exists only in the invite URL response.
// TTL index on expiresAt means Mongo purges expired docs itself — expiry
// isn't only an application-side check.
const FriendInviteSchema = new Schema({
  inviter: { type: Schema.ObjectId, ref: 'users', required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  usedBy: { type: Schema.ObjectId, ref: 'users', default: null },
  createdAt: { type: Date, default: Date.now },
});

FriendInviteSchema.index({ tokenHash: 1 }, { unique: true });
FriendInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('friendInvites', FriendInviteSchema);
