const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// One document per login = one device/session. The JWT carries this doc's
// _id as `deviceId`; auth checks (HTTP + socket) reject any token whose
// session has been revoked, which is what makes per-device logout real
// instead of just "delete the client's local copy" (see DECISIONS.md D-024).
const SessionSchema = new Schema({
  user: { type: Schema.ObjectId, ref: 'users' },
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
});

// Every auth check and the sessions-list route both filter by user first.
SessionSchema.index({ user: 1 });

module.exports = Session = mongoose.model('sessions', SessionSchema);
