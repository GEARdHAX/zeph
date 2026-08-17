const { generateRegistrationOptions } = require('@simplewebauthn/server');
const VaultCredential = require('../../models/VaultCredential');
const User = require('../../models/User');
const config = require('../../../config');
const challenges = require('../../vault/webauthnChallenges');
const { hasValidVaultToken } = require('../../vault/vaultToken');

const handler = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ status: 'error' });

  const existingCredentials = await VaultCredential.find({ user: req.user.id });

  // Registering a NEW passkey once a vault already exists (a PIN or any
  // prior credential) is a privileged action — a stolen main JWT must not
  // be enough to silently enroll an attacker's own authenticator and gain
  // standing vault access. Only the very first ever setup is open on the
  // main JWT alone, same rule as vault-pin-setup.js.
  const vaultAlreadyExists = !!user.vaultPinHash || existingCredentials.length > 0;
  if (vaultAlreadyExists && !hasValidVaultToken(req)) {
    return res.status(403).json({ status: 'error', reason: 'vault_locked' });
  }

  const options = await generateRegistrationOptions({
    rpName: config.vaultRpName,
    rpID: config.vaultRpId,
    userID: Buffer.from(req.user.id.toString()),
    userName: user.username || user.email || req.user.id.toString(),
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.credentialID,
      transports: c.transports,
    })),
  });

  challenges.put(req.user.id, options.challenge);

  res.status(200).json(options);
};

module.exports = handler;
