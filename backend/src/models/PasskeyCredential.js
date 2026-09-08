const mongoose = require('./mongoose');

const Schema = mongoose.Schema;

// One row per passkey a user has enrolled for LOGIN (passwordless sign-in).
// Deliberately separate from vaultCredentials: a vault passkey unlocks the
// in-app Private Vault and must never, on its own, be usable to authenticate
// a whole session — and vice versa. Same @simplewebauthn field shapes as
// VaultCredential; counter is rewritten after every successful assertion to
// catch cloned authenticators.
const PasskeyCredentialSchema = new Schema({
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  credentialID: { type: String, required: true },
  publicKey: { type: Buffer, required: true },
  counter: { type: Number, default: 0 },
  transports: [String],
  label: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
});

PasskeyCredentialSchema.index({ user: 1, credentialID: 1 }, { unique: true });
PasskeyCredentialSchema.index({ credentialID: 1 });

module.exports = mongoose.model('passkeyCredentials', PasskeyCredentialSchema);
