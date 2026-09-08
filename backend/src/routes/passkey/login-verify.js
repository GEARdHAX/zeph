const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const PasskeyCredential = require('../../models/PasskeyCredential');
const User = require('../../models/User');
const config = require('../../../config');
const store = require('../../store');
const challenges = require('../../vault/webauthnChallenges');
const logger = require('../../logger');
const issueSession = require('../../lib/issueSession');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');

const fail = (req, res, reason) => {
  SecurityEventService.record({
    type: 'LOGIN_FAILED',
    severity: 'medium',
    source: securityEventContext(req),
    target: { resource: '/api/login', action: 'login' },
    result: 'failure',
    metadata: { method: 'passkey', reason },
  });
  // Same opaque shape as every other passkey-login failure — never leaks
  // whether the credential existed, the challenge expired, or the signature
  // was bad.
  return res.status(401).json({ error: true, reason: 'passkey_auth_failed' });
};

module.exports = async (req, res) => {
  let response;
  try {
    response = typeof req.fields.response === 'string' ? JSON.parse(req.fields.response) : req.fields.response;
  } catch (e) {
    return fail(req, res, 'malformed_response');
  }
  if (!response || !response.id) return fail(req, res, 'malformed_response');

  const flowId = (req.fields.flowId || '').toString();
  if (!flowId) return fail(req, res, 'missing_flow');

  const expectedChallenge = challenges.take(`passkey-login-flow:${flowId}`);
  if (!expectedChallenge) return fail(req, res, 'challenge_expired');

  const credential = await PasskeyCredential.findOne({ credentialID: response.id }).catch(() => null);
  if (!credential) return fail(req, res, 'unknown_credential');

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
    logger.warn({ err, userId: credential.user }, 'passkey login verification failed');
    return fail(req, res, 'verification_error');
  }

  if (!verification.verified) return fail(req, res, 'not_verified');

  credential.counter = verification.authenticationInfo.newCounter;
  credential.lastUsedAt = new Date();
  await credential.save().catch(() => {});

  const user = await User.findById(credential.user);
  if (!user) return fail(req, res, 'user_gone');

  try {
    const token = await issueSession(user, req, { method: 'passkey' });
    logger.info({ userId: user._id.toString() }, 'login via passkey');
    res.status(200).json({ token });
  } catch (err) {
    logger.error({ err, userId: user._id.toString() }, 'passkey login: session issue failed');
    res.status(500).json({ error: true });
  }
};
