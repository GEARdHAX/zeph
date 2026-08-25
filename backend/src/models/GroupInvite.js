const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Shareable/QR-encodable group join link. tokenHash only (sha256 of the raw
// token) — never the raw token itself. maxUses:null means unlimited; when
// set, join.js increments useCount atomically and rejects once useCount
// reaches maxUses. revokedAt lets a link be killed without deleting the row
// (auditability), same soft-removal style as GroupMember.active.
const GroupInviteSchema = new Schema({
  group: { type: Schema.ObjectId, ref: 'rooms', required: true },
  creator: { type: Schema.ObjectId, ref: 'users', required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  maxUses: { type: Number, default: null },
  useCount: { type: Number, default: 0 },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

GroupInviteSchema.index({ tokenHash: 1 }, { unique: true });
GroupInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
GroupInviteSchema.index({ group: 1 });

module.exports = mongoose.model('groupInvites', GroupInviteSchema);
