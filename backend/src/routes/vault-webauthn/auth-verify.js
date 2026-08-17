const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const VaultCredential = require('../../models/VaultCredential');
const config = require('../../../config');
const store = require('../../store');
const challenges = require('../../vault/webauthnChallenges');
const { signVaultToken } = require('../../vault/vaultToken');
const logger = require('../../logger');

module.exports = async (req, res) => {
  const expectedChallenge = challenges.take(req.user.id);
  if (!expectedChallenge) {
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  let response;
  try {
    response = typeof req.fields.response === 'string' ? JSON.parse(req.fields.response) : req.fields.response;
  } catch (e) {
    return res.status(400).json({ status: 'error' });
  }

  if (!response || !response.id) {
    return res.status(400).json({ status: 'error' });
  }

  const credential = await VaultCredential.findOne({ user: req.user.id, credentialID: response.id });
  if (!credential) {
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: store.config.corsOrigin,
      expectedRPID: config.vaultRpId,
      credential: {
        id: credential.credentialID,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      },
    });
  } catch (err) {
    logger.warn({ err, userId: req.user.id }, 'WebAuthn authentication verification failed');
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  if (!verification.verified) {
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  // Rewrite the stored counter — a later auth attempt with a stale counter
  // indicates a cloned authenticator and will fail verifyAuthenticationResponse.
  credential.counter = verification.authenticationInfo.newCounter;
  await credential.save();

  logger.info({ userId: req.user.id }, 'Vault unlocked via passkey');

  res.status(200).json({ status: 'success', vaultToken: signVaultToken(req.user.id) });
};
