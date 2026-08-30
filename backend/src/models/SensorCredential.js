const crypto = require('crypto');
const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Sensor identity + credential (spec sections 11-13). Deliberately NOT a
// User — a sensor is not an account, has no login, no password, no
// session, and must never be able to reach anything a Passport/JWT-
// authenticated request can (spec section 30: "least privilege... must
// NOT grant admin/user/database/dashboard access"). Same hash-only-storage
// pattern StepUpToken.js (Phase 2) already established: the raw credential
// exists only once, at issuance, in the response body — never persisted,
// never logged.
const SensorCredentialSchema = new Schema({
  // Stable identity distinct from the credential itself (spec section 11:
  // "do not use hostname/IP/PID alone as permanent identity") — sensorId
  // is operator-assigned at registration (e.g. "sensor-prod-01"), hostId
  // is the Linux host it reports observing (a sensor and a host are
  // deliberately separate concepts: redeploying the same sensor to a new
  // host, or running two sensors on one host, are both real scenarios).
  sensorId: {
    type: String, required: true, unique: true,
  },
  hostId: { type: String, required: true },

  credentialHash: { type: String, required: true },

  // Rotation support (spec section 13) — a credential can be REVOKED
  // without deleting the sensorId's history (SecurityEvent documents this
  // sensor produced stay attributable). Issuing a replacement credential
  // for the same sensorId is a new SensorCredential document with the
  // SAME sensorId but a new credentialHash; the old one's revokedAt is set.
  // This phase does NOT implement an automated rotation SCHEDULE (spec
  // section 13 explicitly allows deferring that: "if full rotation cannot
  // be implemented in Phase 4, create the architecture/interface and
  // document it as future hardening") — what exists is the data model and
  // the revoke/reissue capability, exercised manually by an operator.
  revokedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
});

SensorCredentialSchema.index({ sensorId: 1, revokedAt: 1 });

const hashCredential = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

const SensorCredential = mongoose.model('sensorCredentials', SensorCredentialSchema);
SensorCredential.hashCredential = hashCredential;

module.exports = SensorCredential;
