const { generateAuthenticationOptions } = require('@simplewebauthn/server');
const VaultCredential = require('../../models/VaultCredential');
const config = require('../../../config');
const challenges = require('../../vault/webauthnChallenges');

// Intentionally reachable with just the main JWT — this route (and
// auth-verify) IS the unlock entry point itself, same as vault-unlock-pin.js.
module.exports = async (req, res) => {
  const credentials = await VaultCredential.find({ user: req.user.id });

  const options = await generateAuthenticationOptions({
    rpID: config.vaultRpId,
    allowCredentials: credentials.map((c) => ({ id: c.credentialID, transports: c.transports })),
    userVerification: 'preferred',
  });

  challenges.put(req.user.id, options.challenge);

  res.status(200).json(options);
};
