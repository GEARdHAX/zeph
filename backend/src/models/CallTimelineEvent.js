const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Call Timeline / Call History. Individual lifecycle events within a user's
// participation in a meeting — CONNECTED/DISCONNECTED/RECONNECTED for now
// (spec's "core" scope; MIC_MUTED/CAMERA_ON/SCREEN_SHARE_*/CONNECTION_
// QUALITY_CHANGED are deliberately not wired up yet — no existing signal to
// hook them to without inventing new client->server plumbing beyond what
// this pass covers, but the eventType enum below already has room for them
// with zero future schema change).
//
// Deliberately NOT a home for high-frequency data (spec §17): no heartbeats,
// no WebRTC stats, no ICE candidates. One row per MEANINGFUL state
// transition, created only by callHistoryService.js's lifecycle functions —
// never a raw pass-through of client-sent events.
const CallTimelineEventSchema = new Schema({
  meeting: { type: Schema.ObjectId, ref: 'meetings', required: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  session: { type: Schema.ObjectId, ref: 'callSessions', required: true },
  eventType: {
    type: String,
    enum: [
      'CONNECTED',
      'DISCONNECTED',
      'RECONNECTED',
      // Not yet produced by any code path — reserved so a later pass can
      // add them without a migration:
      'MIC_MUTED',
      'MIC_UNMUTED',
      'CAMERA_ON',
      'CAMERA_OFF',
      'SCREEN_SHARE_STARTED',
      'SCREEN_SHARE_STOPPED',
      'CONNECTION_QUALITY_CHANGED',
    ],
    required: true,
  },
  timestamp: { type: Date, required: true },
  // Structured, small, never sensitive (spec §3/§13) — e.g.
  // { reason: 'network' } on DISCONNECTED. No IPs, device fingerprints, or
  // raw WebRTC diagnostics (spec §10/§13 draw that line explicitly).
  metadata: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

CallTimelineEventSchema.index({ user: 1, timestamp: -1 });
CallTimelineEventSchema.index({ meeting: 1, timestamp: -1 });
CallTimelineEventSchema.index({ session: 1, timestamp: 1 });

module.exports = mongoose.model('callTimelineEvents', CallTimelineEventSchema);
