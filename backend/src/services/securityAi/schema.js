// AI output is untrusted input (spec sections 11-14) — the exact same
// posture backend/src/services/ebpf/sensorEventValidation.js already takes
// toward sensor-submitted data. Never parse-and-trust; always validate
// against a strict shape, and never let a field the model invents
// (riskScore, policyDecision, adminRole, trusted, allow — spec section 13's
// explicit denylist) survive into the returned result, even if present in
// the raw JSON.
const SCHEMA_VERSION = 1;

const CATEGORIES = new Set([
  'authentication_behavior', 'network_behavior', 'process_behavior', 'correlation', 'other',
]);

// Advisory only (spec section 11: "recommendedAction is advisory only...
// the backend MUST NOT automatically execute it") — restricted to the
// SAME three values policyEngine.js's own Decisions enum uses, purely so
// the label is meaningful to a human reading it next to a real Zero Trust
// decision; this value is NEVER read by policyEngine.js or fed into any
// enforcement path.
const RECOMMENDED_ACTIONS = new Set(['ALLOW', 'STEP_UP', 'DENY', null]);

// Confidence normalized to 0-100 integer (spec section 12: "choose one
// format consistently") — 0-100 chosen to match every OTHER confidence
// value already in this codebase (ThreatIntelService's confidence,
// SensorCredential-adjacent fields) rather than introducing a second 0.0-1.0
// convention alongside it.
const normalizeConfidence = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // Accept EITHER 0-1 or 0-100 from the model (spec section 12 asks the
  // SYSTEM to pick one consistent format; it does not guarantee the model
  // will comply, and rejecting a plausible 0.82 outright would be an odd
  // failure mode) — 0-1 is upconverted, anything already >1 is treated as
  // already-0-100.
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(normalized)));
};

// Validates ONE parsed JSON object from the model. Returns { ok, result }
// or { ok: false, reason }. Never throws.
const validateAnalysisOutput = (raw) => {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_an_object' };
  if (typeof raw.anomalous !== 'boolean') return { ok: false, reason: 'missing_anomalous' };

  const confidence = normalizeConfidence(raw.confidence);
  if (confidence === null) return { ok: false, reason: 'invalid_confidence' };

  const category = CATEGORIES.has(raw.category) ? raw.category : 'other';

  // A present-but-empty explanation is rejected outright (nothing to
  // salvage); an over-length one is truncated rather than discarding an
  // otherwise-valid analysis — same "truncate, don't reject" posture
  // signals/explanation already take elsewhere for bounded-but-recoverable
  // oversized fields.
  if (typeof raw.explanation !== 'string' || raw.explanation.length === 0) return { ok: false, reason: 'missing_explanation' };

  const signals = Array.isArray(raw.signals)
    ? raw.signals.filter((s) => typeof s === 'string' && s.length <= 64).slice(0, 20)
    : [];

  const recommendedAction = RECOMMENDED_ACTIONS.has(raw.recommendedAction) ? raw.recommendedAction : null;

  return {
    ok: true,
    result: {
      schemaVersion: SCHEMA_VERSION,
      anomalous: raw.anomalous,
      confidence,
      category,
      signals,
      explanation: raw.explanation.slice(0, 1000),
      recommendedAction, // advisory label only — never consumed by policyEngine.js, see this file's own comment
    },
    // Every field NOT copied above (riskScore, policyDecision, adminRole,
    // trusted, allow, or literally anything else the model returned) is
    // simply never read from `raw` again past this point — dropped by
    // construction, not filtered out after the fact.
  };
};

module.exports = {
  validateAnalysisOutput, normalizeConfidence, SCHEMA_VERSION, CATEGORIES, RECOMMENDED_ACTIONS,
};
