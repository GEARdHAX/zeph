const Session = require('../models/Session');
const { ExtractJwt } = require('passport-jwt');
const jwt = require('jsonwebtoken');
const SecurityEventService = require('../services/securityEventService');
const securityEventContext = require('../utils/securityEventContext');

module.exports = async (req, res, next) => {
  const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  const decoded = token ? jwt.decode(token) : null;
  const context = securityEventContext(req);

  if (decoded && decoded.deviceId) {
    await Session.updateOne({ _id: decoded.deviceId, user: req.user.id }, { $set: { revokedAt: new Date() } });
    SecurityEventService.record({
      type: 'TOKEN_REVOKED',
      severity: 'low',
      actor: { userId: req.user.id, sessionId: decoded.deviceId.toString() },
      source: context,
      target: { resource: '/api/logout', action: 'revoke_session' },
      result: 'success',
    });
  }

  SecurityEventService.record({
    type: 'LOGOUT',
    severity: 'low',
    actor: { userId: req.user.id },
    source: context,
    target: { resource: '/api/logout', action: 'logout' },
    result: 'success',
  });

  res.status(200).json({ ok: true });
};
