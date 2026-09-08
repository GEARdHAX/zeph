const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const PasskeyCredential = require('../../models/PasskeyCredential');
const config = require('../../../config');
const store = require('../../store');
const challenges = require('../../vault/webauthnChallenges');
const logger = require('../../logger');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');

module.exports = async (req, res) => {
  const expectedChallenge = challenges.take(`passkey-reg:${req.user.id}`);
  if (!expectedChallenge) return res.status(400).json({ error: true, reason: 'challenge_expired' });

  let response;
  try {
    response = typeof req.fields.response === 'string' ? JSON.parse(req.fields.response) : req.fields.response;
  } catch (e) {
    return res.status(400).json({ error: true });
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
    logger.warn({ err, userId: req.user.id }, 'passkey registration verification failed');
    return res.status(400).json({ error: true });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: true });
  }

  const { credential } = verification.registrationInfo;
  const label = typeof req.fields.label === 'string' ? req.fields.label.slice(0, 60) : '';

  try {
    await PasskeyCredential.create({
      user: req.user.id,
      credentialID: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || [],
      label,
    });
  } catch (err) {
    // Duplicate key = this authenticator is already enrolled for this user.
    if (err && err.code === 11000) return res.status(409).json({ error: true, reason: 'already_registered' });
    logger.error({ err, userId: req.user.id }, 'failed to save passkey credential');
    return res.status(500).json({ error: true });
  }

  SecurityEventService.record({
    type: 'DEVICE_REGISTERED',
    severity: 'low',
    actor: { userId: req.user.id.toString() },
    source: securityEventContext(req),
    target: { resource: '/api/passkey', action: 'passkey_register' },
    result: 'success',
  });

  logger.info({ userId: req.user.id }, 'login passkey registered');
  res.status(200).json({ status: 'success' });
};
