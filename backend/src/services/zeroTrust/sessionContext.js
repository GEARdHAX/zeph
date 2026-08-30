const Session = require('../../models/Session');

// Explicit session states (spec section 7) — layered on TOP of the existing
// revokedAt field, not a schema migration. Session.js itself is untouched;
// these are derived at read time from the fields that already exist
// (revokedAt, createdAt), so every existing route that reads/writes Session
// directly (login.js, logout.js, sessions/revoke.js, the JWT strategies)
// keeps working completely unchanged. A real SUSPICIOUS persisted flag
// would need a schema change and a producer deciding when to set it — out
// of scope for Phase 2's deterministic-rules-only mandate (spec section 33);
// what IS implemented is SUSPICIOUS as a derived state (see
// deriveSessionState below), which is enough for the risk engine to react
// to without introducing a new mutable field two years of future routes
// would need to remember to keep in sync.
const SessionStates = Object.freeze({
  ACTIVE: 'ACTIVE',
  SUSPICIOUS: 'SUSPICIOUS',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  REVOKED: 'REVOKED',
});

// REAUTH_REQUIRED is reserved for a future explicit trigger (e.g. a
// detected account-takeover indicator forcing a hard re-login) — nothing in
// Phase 2 sets it yet; deriveSessionState never returns it today. Declared
// here so riskEngine.js/policyEngine.js can already branch on it without a
// later breaking change to this enum.
//
// A session this function can't resolve (legacy pre-device-session token,
// or any other reason resolveSession() returned null) is deliberately NOT
// REAUTH_REQUIRED here — init.js's own JWT strategy already documents that
// exact case as "same trust level as today," and riskEngine.js already
// scores it as UNKNOWN_DEVICE. Also forcing REAUTH_REQUIRED here would
// double-penalize the same signal through two different mechanisms (a risk
// score bump AND an unconditional hard block bypassing the score
// entirely) — ACTIVE is the correct state; the risk engine is what's
// responsible for treating "no session" as elevated risk, not this
// function short-circuiting past risk scoring altogether.
const deriveSessionState = (session, riskLevel) => {
  if (session?.revokedAt) return SessionStates.REVOKED;
  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') return SessionStates.SUSPICIOUS;
  return SessionStates.ACTIVE;
};

// Resolves the Session document for the current request — req.user.deviceId
// is set by init.js's passport JWT strategy (Phase 2 addition; see its own
// comment) whenever the token carries a deviceId. Returns null for a
// legacy/deviceId-less token, which riskEngine.js treats as
// higher-risk-by-default rather than erroring.
const resolveSession = async (req) => {
  const deviceId = req.user?.deviceId;
  if (!deviceId) return null;
  return Session.findById(deviceId).catch(() => null);
};

// Only the fields spec section 6 actually asks for — never password/token/
// OTP/message content, none of which Session ever had to begin with. This
// is what gets attached to req for downstream middleware/handlers, and
// what a future admin security view (section 26) would render — deliberate
// allowlist shape rather than passing the raw Mongoose document through.
const toSessionContext = (session, riskLevel) => {
  if (!session) {
    return {
      sessionId: null, userId: null, createdAt: null, lastSeenAt: null, authMethod: 'jwt', state: deriveSessionState(null, riskLevel),
    };
  }
  return {
    sessionId: session._id.toString(),
    userId: session.user?.toString() || null,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    userAgent: session.userAgent || null,
    authMethod: 'jwt',
    state: deriveSessionState(session, riskLevel),
  };
};

module.exports = {
  SessionStates, resolveSession, toSessionContext, deriveSessionState,
};
