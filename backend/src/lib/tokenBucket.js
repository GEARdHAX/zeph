// Distributed token-bucket rate limiter — atomic Redis Lua implementation.
// Replaces express-rate-limit's in-memory MemoryStore (init.js) and the
// hand-rolled Map-based fixed-window limiter (lib/inviteRateLimit.js, now
// removed): both were process-local, so N backend instances each gave a
// caller N times the intended budget, and every limit reset on every
// deploy/restart. This is a shared bucket in Redis instead — see
// rateLimitPolicy.js for the configured capacities/refill rates and
// createTokenBucketLimiter.js for the Express middleware built on top.
//
// Token bucket, not fixed-window: a fixed window (express-rate-limit's
// model) resets hard at the window boundary, which both allows a burst of
// 2x the limit right at the boundary (tail of one window + head of the
// next) and forces a caller who used their full budget early to wait out
// the ENTIRE remaining window. A token bucket refills continuously, so
// "limit per minute" actually means a smooth, predictable rate — this is
// a materially different guarantee, not just an implementation swap; see
// docs/RATE-LIMITING.md.
const logger = require('../logger');
const { getClient } = require('./rateLimitClient');

const KEY_PREFIX = 'rl:v1:';

// Atomically: read the bucket, refill it for elapsed time (capped at
// capacity), check whether enough tokens exist for this request's cost,
// and if so consume them — all in one round trip, so no two concurrent
// callers can ever both observe the same pre-consumption token count (the
// exact GET-then-SET race the brief calls out explicitly). Uses Redis's
// own TIME command rather than a client-supplied timestamp — every caller
// (any backend instance, any client clock) computes refill against the
// SAME clock, which is what makes this correct under horizontal scaling
// with instances whose system clocks aren't perfectly synced.
//
// KEYS[1] = bucket key
// ARGV[1] = capacity (max tokens)
// ARGV[2] = refillRate (tokens per second)
// ARGV[3] = cost (tokens this request consumes)
// ARGV[4] = ttlSeconds (key expiry — see rateLimitPolicy.js's ttlFor)
//
// Returns: { allowed (0/1), tokensRemaining, retryAfterSeconds }
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])

local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)

local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(bucket[1])
local lastRefill = tonumber(bucket[2])

if tokens == nil then
  -- First request against this key — bucket starts full (burst up to
  -- capacity is allowed immediately, per the brief's documented semantics).
  tokens = capacity
  lastRefill = nowMs
end

local elapsedSeconds = math.max(0, (nowMs - lastRefill) / 1000)
local refilled = math.min(capacity, tokens + (elapsedSeconds * refillRate))
-- Never allow tokens to go negative (a clock anomaly / bad prior state) or
-- exceed capacity — both explicit invariants from the brief.
refilled = math.max(0, refilled)

local allowed = 0
local remaining = refilled
if refilled >= cost then
  allowed = 1
  remaining = refilled - cost
end

redis.call('HSET', key, 'tokens', remaining, 'lastRefill', nowMs)
redis.call('EXPIRE', key, ttlSeconds)

local retryAfterSeconds = 0
if allowed == 0 then
  local deficit = cost - refilled
  retryAfterSeconds = math.ceil(deficit / refillRate)
  if retryAfterSeconds < 1 then retryAfterSeconds = 1 end
end

return { allowed, tostring(remaining), retryAfterSeconds }
`;

// Full refill time plus a safety margin (brief's own suggested shape) —
// centralized here so every caller gets the same formula rather than
// picking an arbitrary TTL per policy.
const ttlFor = (capacity, refillRate) => Math.ceil(capacity / refillRate) + 30;

// Rejects nonsensical policy values before they ever reach Redis/Lua —
// the brief explicitly lists "zero/negative refill rate," "negative
// costs," "NaN," and "infinite capacity" as things to guard against. This
// is checked once at startup (rateLimitPolicy.js validates every entry
// through here) and again defensively on every call, since a caller could
// theoretically construct a limiter with a bad runtime-computed value.
const validatePolicy = ({ capacity, refillRate, cost }) => {
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error(`Invalid token bucket capacity: ${capacity}`);
  if (!Number.isFinite(refillRate) || refillRate <= 0) throw new Error(`Invalid token bucket refillRate: ${refillRate}`);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error(`Invalid token bucket cost: ${cost}`);
  if (cost > capacity) throw new Error(`Token bucket cost (${cost}) exceeds capacity (${capacity}) — would never allow`);
};

// identity must already be a safe, bounded string — callers (see
// createTokenBucketLimiter.js) are responsible for normalizing/hashing
// anything derived from user input before it reaches here. This function
// only prefixes and namespaces; it doesn't sanitize.
//
// Returns one of:
//   { allowed: true, remaining, redisAvailable: true }
//   { allowed: false, retryAfterSeconds, redisAvailable: true }
//   { allowed: <failMode-dependent>, redisAvailable: false, error }
//     — see createTokenBucketLimiter.js for how failMode is applied; this
//     function itself never decides open-vs-closed, it only reports that
//     Redis was unavailable so the caller's policy can decide.
const consumeToken = async ({ policyName, identity, capacity, refillRate, cost = 1 }) => {
  validatePolicy({ capacity, refillRate, cost });

  const redis = getClient();
  if (!redis) {
    return { allowed: false, redisAvailable: false, error: 'NO_REDIS_CONFIGURED' };
  }

  const key = `${KEY_PREFIX}${policyName}:${identity}`;
  const ttlSeconds = ttlFor(capacity, refillRate);

  try {
    const [allowed, remainingStr, retryAfterSeconds] = await redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      capacity,
      refillRate,
      cost,
      ttlSeconds,
    );
    return {
      allowed: allowed === 1,
      remaining: Number(remainingStr),
      retryAfterSeconds: Number(retryAfterSeconds),
      redisAvailable: true,
    };
  } catch (err) {
    logger.throttledWarn(
      `rate-limit:${policyName}`,
      30000,
      { err, policyName, keyType: identity.split(':')[0] },
      'rate_limit_redis_error',
    );
    return { allowed: false, redisAvailable: false, error: err.message };
  }
};

module.exports = { consumeToken, validatePolicy, ttlFor, KEY_PREFIX, TOKEN_BUCKET_SCRIPT };
