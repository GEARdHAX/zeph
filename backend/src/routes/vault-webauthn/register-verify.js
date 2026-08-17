const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const VaultCredential = require('../../models/VaultCredential');
const User = require('../../models/User');
const config = require('../../../config');
const store = require('../../store');
const challenges = require('../../vault/webauthnChallenges');
const { hasValidVaultToken } = require('../../vault/vaultToken');
const logger = require('../../logger');

module.exports = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ status: 'error' });

  const existingCount = await VaultCredential.countDocuments({ user: req.user.id });
  const vaultAlreadyExists = !!user.vaultPinHash || existingCount > 0;
  if (vaultAlreadyExists && !hasValidVaultToken(req)) {
    return res.status(403).json({ status: 'error', reason: 'vault_locked' });
  }

  const expectedChallenge = challenges.take(req.user.id);
  if (!expectedChallenge) {
    return res.status(400).json({ status: 'error', reason: 'challenge_expired' });
  }

  let response;
  try {
    response = typeof req.fields.response === 'string' ? JSON.parse(req.fields.response) : req.fields.response;
  } catch (e) {
    return res.status(400).json({ status: 'error' });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: store.config.corsOrigin,
      expectedRPID: config.vaultRpId,
    });
  } catch (err) {
    logger.warn({ err, userId: req.user.id }, 'WebAuthn registration verification failed');
    return res.status(400).json({ status: 'error' });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ status: 'error' });
  }

  const { credential } = verification.registrationInfo;

  try {
    await VaultCredential.create({
      user: req.user.id,
      credentialID: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || [],
    });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'Failed to save vault credential');
    return res.status(500).json({ status: 'error' });
  }

  logger.info({ userId: req.user.id }, 'Vault passkey registered');

  res.status(200).json({ status: 'success' });
};
