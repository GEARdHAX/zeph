const crypto = require('crypto');
const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Short-lived step-up authorization artifact (spec section 18). Only the
// SHA-256 hash of the raw token is ever stored — same pattern Phase 1's
// password-reset AuthCode/token handling already established (see
// backend/src/routes/auth/change.js's single-use-consume pattern, which
// this schema's usedAt field mirrors). The raw token exists only in memory
// at issuance and inside the response body sent to the caller — it is
// NEVER logged (see zeroTrust/stepUp.js, which never passes it to
// logger/SecurityEventService) and never placed in a URL.
const StepUpTokenSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  // Bound to the session that requested it — a step-up minted from device A
  // must not authorize a sensitive action from device B, even for the same
  // user (spec section 18: "bind it to the user/session").
  sessionId: { type: Schema.ObjectId, ref: 'sessions', default: null },
  // Bound to the specific resource+action it was issued for (spec section
  // 18: "bind it to the intended sensitive operation where practical") — a
  // step-up minted for change_password cannot be replayed against
  // delete_account.
  resource: { type: String, required: true },
  action: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

StepUpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Mongo TTL — a genuinely ephemeral artifact, unlike SecurityEvent's deliberate no-TTL audit history.
StepUpTokenSchema.index({ user: 1, resource: 1, action: 1 });

const hashToken = (rawToken) => crypto.createHash('sha256').update(rawToken).digest('hex');

module.exports = mongoose.model('stepUpTokens', StepUpTokenSchema);
module.exports.hashToken = hashToken;
