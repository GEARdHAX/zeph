const { evaluate, Decisions } = require('../services/zeroTrust/policyEngine');
const { getRiskContext } = require('../services/zeroTrust/riskEngine');
const { resolveSession, toSessionContext, deriveSessionState } = require('../services/zeroTrust/sessionContext');
const { verifyAndConsumeStepUpToken } = require('../services/zeroTrust/stepUp');
const { categoryFor, PolicyCategory } = require('../services/zeroTrust/policies');
const SecurityEventService = require('../services/securityEventService');
const securityEventContext = require('../utils/securityEventContext');

// Express middleware factory (spec section 21) — mounted AFTER
// passport.authenticate('jwt', ...) on a route, never instead of it. Does
// NOT duplicate authentication; req.user is assumed already set by
// passport. rbacCheck is an optional async (req) => boolean the route
// supplies ONLY when this middleware is the sole place that check can live
// — omitting it means "RBAC requirement is just being authenticated,"
// which is deliberately how EVERY current mount point in routes/index.js
// uses this (see that file's own comment): every sensitive route this
// phase wraps already has its own complete, correct, inline RBAC/business-
// rule validation (groupPolicy.hasCapability + role-hierarchy + self-target
// checks, returning specific 400/403/404 per failure mode). Giving
// rbacCheck a coarser re-derivation of that same decision here would run
// BEFORE the handler and pre-empt its more specific response with a
// generic 403 — this happened once already (group role-change/ban) and
// broke existing privilege-escalation tests; the fix was removing
// rbacCheck from those mount points entirely, not fixing the check. Only
// reach for rbacCheck on a FUTURE route that has no other RBAC gate at all.
//
// NORMAL-category actions are a fast path by design (spec section 31: "do
// not add expensive database queries to every request") — this middleware
// is only ever mounted on SENSITIVE/ADMINISTRATIVE routes (see
// policies.js's POLICY_CATEGORIES table and this file's own comment on
// why). If a route somehow isn't in that table, categoryFor() defaults to
// NORMAL and the middleware still runs the full evaluation rather than
// silently skipping it — mounting zeroTrust() on a route is itself the
// signal "this needs evaluating," the category only changes HOW STRICT.
const zeroTrust = ({ resource, action, rbacCheck }) => async (req, res, next) => {
  try {
    if (!req.user) {
      // Should be unreachable in practice (passport.authenticate already
      // ran and would have 401'd), but never assume — an explicit DENY
      // here costs nothing and closes any future mounting-order mistake.
      return res.status(401).json({ error: true, reason: 'not_authenticated' });
    }

    const session = await resolveSession(req);
    // req.ip (not a raw header) — same trust-proxy-respecting resolution
    // securityEventContext(req) already uses elsewhere; see its own
    // comment for why this never reads X-Forwarded-For/CF-Connecting-IP
    // directly (Phase 3 spec section 28: never let a client spoof the IP
    // ZEPH spends threat-intel quota looking up).
    const riskContext = await getRiskContext({ userId: req.user.id, session, ip: req.ip });
    const sessionState = deriveSessionState(session, riskContext.level);
    const rbacAllowed = rbacCheck ? await rbacCheck(req) : true;

    const result = evaluate({
      user: req.user,
      session,
      sessionState,
      rbacAllowed,
      resource,
      action,
      riskContext,
    });

    // Every decision is telemetered (spec section 24) — ALLOW at low
    // severity (routine, high volume, matches Phase 1's convention of not
    // over-logging routine success), STEP_UP/DENY at higher severity since
    // those are the operationally interesting ones.
    SecurityEventService.record({
      type: result.decision === Decisions.ALLOW ? 'ZERO_TRUST_ALLOW'
        : result.decision === Decisions.STEP_UP ? 'ZERO_TRUST_STEP_UP' : 'ZERO_TRUST_DENY',
      severity: result.decision === Decisions.ALLOW ? 'low' : (categoryFor(resource, action) === PolicyCategory.ADMINISTRATIVE ? 'high' : 'medium'),
      actor: { userId: req.user.id, sessionId: session?._id?.toString() || null },
      source: securityEventContext(req),
      target: { resource, action },
      result: result.decision === Decisions.ALLOW ? 'success' : 'blocked',
      metadata: {
        riskScore: result.riskScore, riskLevel: result.riskLevel, policy: result.policy, reason: result.reason,
      },
    });

    if (result.decision === Decisions.DENY) {
      return res.status(403).json({ error: true, reason: 'zero_trust_denied' });
    }

    if (result.decision === Decisions.STEP_UP) {
      // A client-supplied step-up token (see services/zeroTrust/stepUp.js)
      // in the SAME request lets a caller who already completed step-up
      // moments ago (e.g. retrying after a network blip) proceed without a
      // second round trip — verified server-side, single-use, scoped to
      // this exact resource/action/session; never trusted merely because
      // it's present (spec section 35: any client-provided decision input
      // is untreated as untrusted — this only ever RAISES the bar, it can't
      // lower it, since a missing/invalid token just falls through to the
      // 428 below).
      const stepUpToken = req.headers['x-step-up-token'];
      if (stepUpToken) {
        const consumed = await verifyAndConsumeStepUpToken({
          rawToken: stepUpToken, userId: req.user.id, sessionId: session?._id, resource, action,
        });
        if (consumed.ok) {
          req.zeroTrust = { ...result, decision: Decisions.ALLOW, stepUpConsumed: true };
          return next();
        }
      }
      // 428 Precondition Required — the standard status for "you must
      // complete an additional step before this request can succeed,"
      // distinct from 401 (not authenticated) and 403 (flatly forbidden).
      return res.status(428).json({
        error: true, reason: 'step_up_required', policy: result.policy,
      });
    }

    req.zeroTrust = result;
    return next();
  } catch (err) {
    // Fail-safe per spec section 30: a Zero Trust evaluation failure on a
    // route this middleware is mounted on (by definition SENSITIVE/
    // ADMINISTRATIVE) fails CLOSED, not open — an exception here must never
    // silently let a sensitive action through.
    SecurityEventService.record({
      type: 'ZERO_TRUST_DENY',
      severity: 'high',
      actor: { userId: req.user?.id || null },
      source: securityEventContext(req),
      target: { resource, action },
      result: 'blocked',
      metadata: { reason: 'evaluation_error' },
    });
    return res.status(503).json({ error: true, reason: 'security_evaluation_failed' });
  }
};

module.exports = zeroTrust;
