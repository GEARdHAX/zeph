const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// One row per registered passkey. publicKey/counter/transports come straight
// from @simplewebauthn/server's verifyRegistrationResponse() result —
// counter is rewritten after every successful auth to detect cloned
// authenticators (a stale counter on a later auth attempt means replay).
const VaultCredentialSchema = new Schema({
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  credentialID: { type: String, required: true },
  publicKey: { type: Buffer, required: true },
  counter: { type: Number, default: 0 },
  transports: [String],
  createdAt: { type: Date, default: Date.now },
});

VaultCredentialSchema.index({ user: 1, credentialID: 1 }, { unique: true });

module.exports = mongoose.model('vaultCredentials', VaultCredentialSchema);
