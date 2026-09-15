const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Call Timeline / Call History. One document per individual CONNECTION —
// not per participation. A user who disconnects and reconnects to the same
// meeting gets a SECOND CallSession, never an overwrite of the first (spec
// §2/§6's worked example: Session 1 10:00->10:15, Session 2 10:18->10:30,
// both preserved). MeetingParticipant (one row per meeting+user) is the
// higher-level "did they ever join" record; this is "each time they did."
//
// Keyed by socket, not just user — spec §16: Zeph's mediasoup layer already
// supports multiple simultaneous sockets per user (store.consumerUserIDs is
// an array of socket ids, not deduplicated by user — see mediasoup/index.js).
// A second tab/device must get its own independent session, never close the
// first one's.
const CallSessionSchema = new Schema({
  meeting: { type: Schema.ObjectId, ref: 'meetings', required: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  // The mediasoup socket.id this session belongs to. Used only to route a
  // later disconnect to the RIGHT session when a user has multiple sockets
  // (spec §16) — never exposed to any client, never used for authorization.
  socketId: { type: String, required: true },
  connectedAt: { type: Date, required: true },
  disconnectedAt: { type: Date, default: null },
  // Server-computed only (connectedAt/disconnectedAt are both server
  // timestamps) — spec §7/§20: never trust a client-provided duration.
  // Null while the session is still active; computed on close, not
  // recomputed on every read (see callHistoryService.js#sessionDuration for
  // the dynamic fallback used when a session is still open).
  durationSeconds: { type: Number, default: null },
  disconnectReason: {
    type: String,
    enum: ['left', 'network', 'server', 'meeting_ended', null],
    default: null,
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'CLOSED'],
    default: 'ACTIVE',
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// closeActiveSession's findOneAndUpdate targets exactly one session by
// socketId — the natural idempotency key for "close THIS connection."
CallSessionSchema.index({ socketId: 1, status: 1 });
CallSessionSchema.index({ meeting: 1, user: 1 });
CallSessionSchema.index({ user: 1, connectedAt: -1 });
CallSessionSchema.index({ meeting: 1, connectedAt: -1 });

module.exports = mongoose.model('callSessions', CallSessionSchema);
