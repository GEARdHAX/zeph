const { categoryFor, POLICY_THRESHOLDS, DENY_ABOVE } = require('./policies');
const { SessionStates } = require('./sessionContext');

// Normalized decision shape (spec section 4). Only three decision values
// ever produced — no arbitrary new ones (spec: "do not create arbitrary
// decision types unless the existing architecture genuinely requires them").
const Decisions = Object.freeze({
  ALLOW: 'ALLOW',
  STEP_UP: 'STEP_UP',
  DENY: 'DENY',
});

const decide = (decision, { reason, policy, riskContext, factors = [] }) => ({
  decision,
  reason,
  policy,
  riskScore: riskContext?.score ?? null,
  riskLevel: riskContext?.level ?? null,
  factors: factors.length ? factors : (riskContext?.factors || []),
});

// Central Zero Trust decision point (spec sections 4, 14, 15). Evaluates
// STRICTLY in the order spec section 15 lays out — each step can only
// narrow the outcome, never widen it, and RBAC (step 3) is a hard
// prerequisite this engine composes on top of rather than replaces or
// re-implements (spec section 14: "RBAC must still apply... risk score must
// NOT replace authorization"). rbacAllowed is computed by the CALLER (the
// zeroTrust() middleware) using the existing authorization/policy.js or
// authorization/groupPolicy.js — this engine never makes an RBAC decision
// itself, it only consumes one.
//
// Inputs:
//   user           - req.user (Mongoose User doc) or null (unauthenticated)
//   session        - resolved Session doc or null (sessionContext.js)
//   sessionState   - one of SessionStates (sessionContext.js)
//   rbacAllowed    - boolean, already decided by the caller via existing RBAC
//   resource/action - the policy key (see policies.js)
//   riskContext    - { score, level, factors } from riskEngine.js
const evaluate = ({
  user, session, sessionState, rbacAllowed, resource, action, riskContext,
}) => {
  // 1. Authenticated?
  if (!user) {
    return decide(Decisions.DENY, { reason: 'not_authenticated', policy: 'authentication_required', riskContext });
  }

  // 2. Session valid? A REVOKED session is an automatic, risk-score-
  // independent DENY — no amount of "low risk elsewhere" can override an
  // explicitly revoked session (spec section 20).
  if (sessionState === SessionStates.REVOKED) {
    return decide(Decisions.DENY, { reason: 'session_revoked', policy: 'session_validity', riskContext });
  }

  // 3. RBAC — a hard gate, evaluated BEFORE risk. A risk score of 0 must
  // never grant access RBAC itself denies (spec section 14's worked
  // example: "Risk = 10 does not mean User can access admin panel").
  if (!rbacAllowed) {
    return decide(Decisions.DENY, { reason: 'rbac_denied', policy: 'rbac', riskContext });
  }

  // 4. Session/device context acceptable? REAUTH_REQUIRED (no resolvable
  // session context at all, or a future explicit forced-reauth trigger —
  // see sessionContext.js) can't be risk-scored into an ALLOW; it needs a
  // real re-authentication, which this phase surfaces as STEP_UP (spec
  // section 17: "establish a framework/state" where no deeper mechanism
  // exists yet).
  if (sessionState === SessionStates.REAUTH_REQUIRED) {
    return decide(Decisions.STEP_UP, { reason: 'reauth_required', policy: 'session_context', riskContext });
  }

  // 5/6/7. Risk-based policy evaluation, using the category-specific
  // threshold table (policies.js) — this is where NORMAL vs SENSITIVE vs
  // ADMINISTRATIVE actually diverges.
  const category = categoryFor(resource, action);
  const score = riskContext?.score ?? 0;
  const { allowBelow } = POLICY_THRESHOLDS[category];
  const policyName = `${category.toLowerCase()}_action`;

  if (score > DENY_ABOVE) {
    return decide(Decisions.DENY, {
      reason: 'risk_critical', policy: policyName, riskContext,
    });
  }
  if (score >= allowBelow) {
    return decide(Decisions.STEP_UP, {
      reason: sessionState === SessionStates.SUSPICIOUS ? 'suspicious_session' : 'risk_above_threshold',
      policy: policyName,
      riskContext,
    });
  }

  return decide(Decisions.ALLOW, { reason: 'risk_acceptable', policy: policyName, riskContext });
};

module.exports = { evaluate, Decisions };
