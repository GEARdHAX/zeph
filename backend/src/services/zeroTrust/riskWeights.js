// Centralized, deterministic risk-scoring configuration (spec section 13) —
// every weight lives here so scoring rules can change without touching
// riskEngine.js's logic. Not treated as immutable; a future phase may tune
// these based on real signal, but they must always change here, never
// inline at a call site.
const RISK_WEIGHTS = Object.freeze({
  KNOWN_DEVICE: -10,
  UNKNOWN_DEVICE: 20,
  NEW_SESSION: 10,
  RECENT_FAILED_LOGINS: 25,
  RECENT_PERMISSION_DENIED: 15,
  RATE_LIMIT_TRIGGERED: 25,
  SUSPICIOUS_SESSION: 30,
  REVOKED_SESSION: 100, // effectively forces DENY regardless of anything else — see riskEngine.js
  // Phase 3 — Threat Intelligence signal (spec section 24 of the Phase 3
  // spec's own worked example). A CONFIRMED malicious IP contributes a
  // meaningful but non-decisive amount — never alone enough to force DENY
  // on its own at the SENSITIVE threshold (50): 40 plus this request's
  // baseline UNKNOWN_DEVICE(20)/NEW_SESSION(10) would total 70, still only
  // HIGH -> STEP_UP, matching "Threat Intelligence provides evidence, not
  // authority" (Phase 3 spec section 2) — RBAC/Zero Trust still decide.
  MALICIOUS_IP: 40,
  // Phase 6 — AI authentication-anomaly signal (spec section 24-25).
  // Deliberately the SMALLEST non-trivial weight in this table — AI is
  // advisory, never authoritative (spec section 2/70), so its maximum
  // possible contribution to a user's own risk score must be meaningfully
  // less than a single deterministic factor like RECENT_FAILED_LOGINS(25)
  // or MALICIOUS_IP(40). This is the ENTIRE bounded contribution — see
  // riskEngine.js's own comment for why it's capped, deduplicated (one
  // cached AI result per riskCache.js TTL window, same anti-amplification
  // property MALICIOUS_IP already has), and scoped ONLY to AI's
  // authentication-pattern analysis (never host/network/process analysis
  // — see riskEngine.js's Phase 4/5 non-integration comment, which applies
  // identically to AI's analysis of that same host-level data).
  AI_AUTH_ANOMALY: 15,
});

// Score is clamped to [0, 100] after summing every applicable factor's
// weight — a floor/ceiling, not a probability distribution, so weights
// don't need to sum to anything meaningful on their own.
const RISK_BANDS = Object.freeze([
  { max: 30, level: 'LOW' },
  { max: 60, level: 'MEDIUM' },
  { max: 80, level: 'HIGH' },
  { max: 100, level: 'CRITICAL' },
]);

const riskLevelFor = (score) => (RISK_BANDS.find((band) => score <= band.max) || RISK_BANDS[RISK_BANDS.length - 1]).level;

module.exports = { RISK_WEIGHTS, RISK_BANDS, riskLevelFor };
