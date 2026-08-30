const { issueStepUpToken } = require('../../services/zeroTrust/stepUp');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');
const { resolveSession } = require('../../services/zeroTrust/sessionContext');

// POST /api/security/step-up — the actual verification endpoint a client
// calls after receiving a 428 step_up_required from lib/zeroTrust.js's
// middleware (spec sections 17/18). Body: { resource, action, password }.
// Never logs the raw password or the returned token (see stepUp.js's own
// comment on why — issueStepUpToken never surfaces the raw token to
// anything but this response body).
module.exports = async (req, res) => {
  const { resource, action, password } = req.fields;
  if (!resource || !action || !password) {
    return res.status(400).json({ error: true, reason: 'missing_fields' });
  }

  const session = await resolveSession(req);
  const result = await issueStepUpToken({
    userId: req.user.id, sessionId: session?._id, resource, action, password,
  });

  if (!result.ok) {
    // Same generic-failure posture as every other password-reverification
    // route in this app (users/delete-account.js) — 403 with a reason code,
    // never anything that would help an attacker distinguish "wrong
    // password" from some other failure class.
    SecurityEventService.record({
      type: 'ZERO_TRUST_DENY',
      severity: 'medium',
      actor: { userId: req.user.id, sessionId: session?._id?.toString() || null },
      source: securityEventContext(req),
      target: { resource, action: 'step_up' },
      result: 'blocked',
      metadata: { reason: result.reason },
    });
    return res.status(403).json({ error: true, reason: 'step_up_failed' });
  }

  SecurityEventService.record({
    type: 'ZERO_TRUST_ALLOW',
    severity: 'low',
    actor: { userId: req.user.id, sessionId: session?._id?.toString() || null },
    source: securityEventContext(req),
    target: { resource, action: 'step_up' },
    result: 'success',
  });

  // token is returned exactly once, in this response body only — the
  // caller re-sends the SAME original sensitive request with an
  // X-Step-Up-Token header carrying it (see lib/zeroTrust.js).
  res.status(200).json({ status: 'success', token: result.token, expiresAt: result.expiresAt });
};
