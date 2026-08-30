const Session = require('../../models/Session');
const store = require('../../store');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');
const { invalidateRiskContext } = require('../../services/zeroTrust/riskCache');

module.exports = async (req, res, next) => {
  const { id } = req.fields;
  if (!id) return res.status(400).json({ error: true });

  const session = await Session.findOne({ _id: id, user: req.user.id });
  if (!session) return res.status(404).json({ error: true });

  session.revokedAt = new Date();
  await session.save();

  // A distinct moment from any Zero Trust risk evaluation (lib/zeroTrust.js
  // already records ZERO_TRUST_DENY the NEXT time the revoked session tries
  // a sensitive action) — this is the revocation itself, worth its own
  // event. Also drop the cached risk context so a request already in flight
  // against this session doesn't ride out the rest of riskCache.js's TTL
  // window before its session-revoked check kicks in.
  SecurityEventService.record({
    type: 'SESSION_REVOKED',
    severity: 'medium',
    actor: { userId: req.user.id, sessionId: id },
    source: securityEventContext(req),
    target: { resource: 'session', resourceId: id, action: 'revoke' },
    result: 'success',
  });
  invalidateRiskContext(id).catch(() => {});

  // Disconnect any live socket authenticated under this session right away —
  // otherwise a revoked device stays connected until its next reconnect.
  Object.values(store.sockets || {}).forEach((socket) => {
    if (socket.decoded_token && socket.decoded_token.deviceId === id) {
      socket.emit('unauthorized', { message: 'session_revoked' });
      socket.disconnect(true);
    }
  });

  res.status(200).json({ ok: true });
};
