const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Audit record: "this user accepted this invite," independent of whether
// they ever actually connected to the meeting. Deliberately separate from
// MeetingParticipant/CallSession (backend-confirmed connection, written
// only from mediasoup/index.js's 'join' handler) — INVITE ACCEPTED is not
// MEETING CONNECTED. No IP/device fingerprint stored (not a documented
// requirement here, see FriendInvite/GroupInvite's own audit rows for the
// same minimal-fields convention).
const MeetingInviteAcceptanceSchema = new Schema({
  invite: { type: Schema.ObjectId, ref: 'meetingInvites', required: true },
  meeting: { type: Schema.ObjectId, ref: 'meetings', required: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  acceptedAt: { type: Date, default: Date.now },
});

// One acceptance row per (invite, user) — repeat accepts are idempotent at
// the route level (see routes/meetings/invites/accept.js), this index is
// the actual concurrency guard.
MeetingInviteAcceptanceSchema.index({ invite: 1, user: 1 }, { unique: true });
MeetingInviteAcceptanceSchema.index({ meeting: 1, user: 1 });

module.exports = mongoose.model('meetingInviteAcceptances', MeetingInviteAcceptanceSchema);
