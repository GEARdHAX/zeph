// Central policy table for the distributed token-bucket rate limiter — ONE
// source of truth, so capacity/refill numbers never get scattered across
// route files (the brief's explicit requirement). Every policy here
// replaces exactly one express-rate-limit instance (init.js) or
// inviteRateLimit(...) call (routes/index.js) that existed before this
// migration — see docs/RATE-LIMITING.md for the full before/after mapping.
//
// capacity/refillRate below are converted from each limiter's OLD
// (max, windowMs) pair: capacity = max (preserves the same burst size the
// old limiter allowed), refillRate = max / windowSeconds (preserves the
// same long-run average throughput). These are carried-over values, not
// newly tuned ones — see the brief's own "do not claim these are
// scientifically optimal" instruction. Every value is env-overridable so
// they can be retuned from real production traffic without a code change.
const store = require('../store');

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// windowMs -> refillRate (tokens/second) for a given capacity, matching
// the old limiter's long-run average exactly.
const perSecond = (capacity, windowMs) => capacity / (windowMs / 1000);

const config = () => store.config || {};

// Each entry: { capacity, refillRate, cost }. `cost` defaults to 1 and is
// only ever read by createTokenBucketLimiter.js's caller if a route
// explicitly needs a higher cost (none currently do — see the brief's
// "do not introduce arbitrary costs everywhere").
const POLICIES = {
  // ── Migrated from init.js's express-rate-limit instances ──────────────
  AUTH: {
    // Was: 20 / 15 min (login, register, password reset, email verify)
    capacity: () => toNumber(process.env.RATE_LIMIT_AUTH_CAPACITY, 20),
    refillRate: () => toNumber(process.env.RATE_LIMIT_AUTH_REFILL_PER_SECOND, perSecond(20, 15 * 60 * 1000)),
  },
  API: {
    // Was: 300 / 15 min (general /api catch-all)
    capacity: () => toNumber(process.env.RATE_LIMIT_API_CAPACITY, 300),
    refillRate: () => toNumber(process.env.RATE_LIMIT_API_REFILL_PER_SECOND, perSecond(300, 15 * 60 * 1000)),
  },
  AI: {
    // Was: 15 / 15 min (generic HTTP guard on /api/ai — distinct from and
    // in addition to ai/quota.js's own Redis-backed per-user/day/concurrent
    // governance, which this migration does NOT touch — see
    // docs/RATE-LIMITING.md's "why AI quota remains separate" section).
    capacity: () => toNumber(process.env.RATE_LIMIT_AI_CAPACITY, 15),
    refillRate: () => toNumber(process.env.RATE_LIMIT_AI_REFILL_PER_SECOND, perSecond(15, 15 * 60 * 1000)),
  },
  DISCOVERY: {
    // Was: 100 / 15 min (search, friend requests, room/group creation)
    capacity: () => toNumber(process.env.RATE_LIMIT_DISCOVERY_CAPACITY, 100),
    refillRate: () => toNumber(process.env.RATE_LIMIT_DISCOVERY_REFILL_PER_SECOND, perSecond(100, 15 * 60 * 1000)),
  },
  DELETE: {
    // Was: 60 / 15 min (message/conversation/group deletion)
    capacity: () => toNumber(process.env.RATE_LIMIT_DELETE_CAPACITY, 60),
    refillRate: () => toNumber(process.env.RATE_LIMIT_DELETE_REFILL_PER_SECOND, perSecond(60, 15 * 60 * 1000)),
  },
  VAULT_UNLOCK: {
    // Was: 8 / 15 min (Private Vault PIN/WebAuthn unlock) — security-
    // sensitive, fails closed (see createTokenBucketLimiter.js).
    capacity: () => toNumber(process.env.RATE_LIMIT_VAULT_UNLOCK_CAPACITY, 8),
    refillRate: () => toNumber(process.env.RATE_LIMIT_VAULT_UNLOCK_REFILL_PER_SECOND, perSecond(8, 15 * 60 * 1000)),
  },

  // ── Migrated from lib/inviteRateLimit.js's 11 call sites ───────────────
  INVITE_CREATE: {
    // Was: 20 / hour (friend + group invite creation)
    capacity: () => toNumber(process.env.RATE_LIMIT_INVITE_CREATE_CAPACITY, 20),
    refillRate: () => toNumber(process.env.RATE_LIMIT_INVITE_CREATE_REFILL_PER_SECOND, perSecond(20, 60 * 60 * 1000)),
  },
  INVITE_PREVIEW: {
    // Was: 30 / min (friend + group invite preview, unauthenticated)
    capacity: () => toNumber(process.env.RATE_LIMIT_INVITE_PREVIEW_CAPACITY, 30),
    refillRate: () => toNumber(process.env.RATE_LIMIT_INVITE_PREVIEW_REFILL_PER_SECOND, perSecond(30, 60 * 1000)),
  },
  INVITE_ACCEPT: {
    // Was: 20 / min (friend + group invite accept/join) — security-
    // sensitive (token brute-force surface), fails closed.
    capacity: () => toNumber(process.env.RATE_LIMIT_INVITE_ACCEPT_CAPACITY, 20),
    refillRate: () => toNumber(process.env.RATE_LIMIT_INVITE_ACCEPT_REFILL_PER_SECOND, perSecond(20, 60 * 1000)),
  },
  MEETING_INVITE_CREATE: {
    // Was: 20 / hour — kept as its own bucket, separate from INVITE_CREATE,
    // because meeting links are created far more often per normal session
    // (a new link per call) than friend/group invites (see routes/index.js's
    // original comment this migration preserves the reasoning of).
    capacity: () => toNumber(process.env.RATE_LIMIT_MEETING_INVITE_CREATE_CAPACITY, 20),
    refillRate: () =>
      toNumber(process.env.RATE_LIMIT_MEETING_INVITE_CREATE_REFILL_PER_SECOND, perSecond(20, 60 * 60 * 1000)),
  },
  MEETING_INVITE_PREVIEW: {
    // Was: 30 / min
    capacity: () => toNumber(process.env.RATE_LIMIT_MEETING_INVITE_PREVIEW_CAPACITY, 30),
    refillRate: () =>
      toNumber(process.env.RATE_LIMIT_MEETING_INVITE_PREVIEW_REFILL_PER_SECOND, perSecond(30, 60 * 1000)),
  },
  MEETING_INVITE_ACCEPT: {
    // Was: 20 / min — security-sensitive (token brute-force), fails closed.
    capacity: () => toNumber(process.env.RATE_LIMIT_MEETING_INVITE_ACCEPT_CAPACITY, 20),
    refillRate: () =>
      toNumber(process.env.RATE_LIMIT_MEETING_INVITE_ACCEPT_REFILL_PER_SECOND, perSecond(20, 60 * 1000)),
  },
  MESSAGE_SEND: {
    // Was: 60 / min
    capacity: () => toNumber(process.env.RATE_LIMIT_MESSAGE_SEND_CAPACITY, 60),
    refillRate: () => toNumber(process.env.RATE_LIMIT_MESSAGE_SEND_REFILL_PER_SECOND, perSecond(60, 60 * 1000)),
  },
  MESSAGE_SEARCH: {
    // Was: 30 / min
    capacity: () => toNumber(process.env.RATE_LIMIT_MESSAGE_SEARCH_CAPACITY, 30),
    refillRate: () => toNumber(process.env.RATE_LIMIT_MESSAGE_SEARCH_REFILL_PER_SECOND, perSecond(30, 60 * 1000)),
  },
  REPORT_CREATE: {
    // Was: 10 / hour
    capacity: () => toNumber(process.env.RATE_LIMIT_REPORT_CREATE_CAPACITY, 10),
    refillRate: () => toNumber(process.env.RATE_LIMIT_REPORT_CREATE_REFILL_PER_SECOND, perSecond(10, 60 * 60 * 1000)),
  },
  PASSKEY_LOGIN: {
    // Was: 20 / min — unauthenticated, security-sensitive, fails closed.
    capacity: () => toNumber(process.env.RATE_LIMIT_PASSKEY_LOGIN_CAPACITY, 20),
    refillRate: () => toNumber(process.env.RATE_LIMIT_PASSKEY_LOGIN_REFILL_PER_SECOND, perSecond(20, 60 * 1000)),
  },
  SECURITY_AI_ANALYZE: {
    // Was: 20 / min (admin-only manual AI analysis trigger)
    capacity: () => toNumber(process.env.RATE_LIMIT_SECURITY_AI_ANALYZE_CAPACITY, 20),
    refillRate: () =>
      toNumber(process.env.RATE_LIMIT_SECURITY_AI_ANALYZE_REFILL_PER_SECOND, perSecond(20, 60 * 1000)),
  },
};

// Security-sensitive policies fail CLOSED when Redis is unavailable (the
// brief's explicit requirement for "authentication abuse protection, vault
// unlock, invite acceptance/creation"). This implementation applies that
// SAME fail-closed posture to every policy, not just those — a uniform
// rule was chosen over a per-category split specifically to avoid the old
// MemoryStore's unlimited-fallback failure mode ever silently reappearing
// for "just the general traffic" policies (see the project decision
// recorded in docs/RATE-LIMITING.md). The names below are the ones the
// original per-category design would have required to fail closed;
// ALL_POLICY_NAMES extends that to the full table so resolvePolicy's
// failClosed field actually reflects what createTokenBucketLimiter.js
// really does on a Redis error for every route, not just these.
const SECURITY_SENSITIVE = new Set([
  'AUTH',
  'VAULT_UNLOCK',
  'INVITE_ACCEPT',
  'INVITE_CREATE',
  'MEETING_INVITE_ACCEPT',
  'MEETING_INVITE_CREATE',
  'PASSKEY_LOGIN',
]);
const ALL_POLICY_NAMES = new Set(Object.keys(POLICIES));
const FAIL_CLOSED = ALL_POLICY_NAMES;

// Resolves a named policy's live (possibly env-overridden) numeric values.
// Called per-request, not cached at startup, so an env var change picked
// up by a process restart takes effect without needing a code change —
// matches every other config.js-driven value in this codebase.
const resolvePolicy = (name) => {
  const policy = POLICIES[name];
  if (!policy) throw new Error(`Unknown rate limit policy: ${name}`);
  return {
    name,
    capacity: policy.capacity(),
    refillRate: policy.refillRate(),
    failClosed: FAIL_CLOSED.has(name),
  };
};

// Startup validation (called once from index.js) — fail fast on a
// misconfigured env var rather than discovering a broken policy on the
// first real request. Reuses tokenBucket.js's own validator so there's
// exactly one definition of "valid."
const validateAllPolicies = () => {
  const { validatePolicy } = require('./tokenBucket');
  Object.keys(POLICIES).forEach((name) => {
    const { capacity, refillRate } = resolvePolicy(name);
    validatePolicy({ capacity, refillRate, cost: 1 });
  });
};

module.exports = { POLICIES, resolvePolicy, validateAllPolicies, perSecond, config, SECURITY_SENSITIVE };
