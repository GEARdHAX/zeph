const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Shareable/QR-encodable meeting join link — same shape as GroupInvite.js
// (tokenHash only, never the raw token; maxUses:null means unlimited;
// revokedAt soft-revokes without deleting the row for audit). The one real
// difference from GroupInvite: expiresAt is CALLER-SELECTED at creation
// time (see routes/meetings/invites/create.js's EXPIRY_OPTIONS), not a
// fixed constant — a meeting invite is meant to be much shorter-lived than
// a 7-day group invite.
const MeetingInviteSchema = new Schema({
  meeting: { type: Schema.ObjectId, ref: 'meetings', required: true },
  createdBy: { type: Schema.ObjectId, ref: 'users', required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  maxUses: { type: Number, default: null },
  useCount: { type: Number, default: 0 },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

MeetingInviteSchema.index({ tokenHash: 1 }, { unique: true });
// TTL cleanup is a housekeeping convenience, NOT the authoritative expiry
// check — every read/accept path explicitly compares expiresAt against
// `new Date()` in its own query filter (see preview.js/accept.js), since
// Mongo's TTL background sweep only runs ~once/minute and must never be the
// thing standing between "expired" and "still usable".
MeetingInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
MeetingInviteSchema.index({ meeting: 1 });

module.exports = mongoose.model('meetingInvites', MeetingInviteSchema);
