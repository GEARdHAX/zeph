const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Call Timeline / Call History (per-user). One document per (meeting, user)
// pair — represents "did this user ever participate in this meeting,"
// distinct from CallSession (one document per individual connection —
// a user can have many sessions across one participation) and
// CallTimelineEvent (individual lifecycle events within those sessions).
// See docs/ZEPH-AI-ARCHITECTURE.md's "Call Timeline / Call History" section
// for the full Meeting -> MeetingParticipant -> CallSession -> Timeline
// hierarchy and how this differs from Meeting.users (which already existed
// for meeting-summary authorization — kept as-is, not migrated, since
// nothing needing THIS model's timestamps existed before now).
const MeetingParticipantSchema = new Schema({
  meeting: { type: Schema.ObjectId, ref: 'meetings', required: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  // First time this user was ever confirmed connected to this meeting —
  // set once, on the FIRST CallSession, never overwritten by a later
  // reconnect (createOrGetParticipant in callHistoryService.js enforces
  // this with an upsert that only sets joinedAt on insert).
  joinedAt: { type: Date, required: true },
  // Updated to "now" every time the user's active session closes (leave,
  // disconnect, or server-side cleanup) — always reflects their MOST
  // RECENT departure, so it's meaningful even after a reconnect.
  leftAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// One participant identity per (meeting, user) — never a second row for a
// reconnect (spec §6: "DO NOT create a new MeetingParticipant identity that
// destroys history"). Upserted via findOneAndUpdate with this as the query.
MeetingParticipantSchema.index({ meeting: 1, user: 1 }, { unique: true });
// GET /api/calls/history lists a user's own history sorted by recency.
MeetingParticipantSchema.index({ user: 1, joinedAt: -1 });

module.exports = mongoose.model('meetingParticipants', MeetingParticipantSchema);
