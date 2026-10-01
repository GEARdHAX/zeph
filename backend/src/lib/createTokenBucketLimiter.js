// Express middleware factory wrapping the Redis token bucket (tokenBucket.js)
// — the single reusable abstraction every migrated rate-limited route uses,
// so the atomic-consume/identity/429-shaping logic lives in exactly one
// place rather than being reimplemented per route (the brief's explicit
// "do not duplicate token-bucket logic in every route" requirement).
const logger = require('../logger');
const SecurityEventService = require('../services/securityEventService');
const securityEventContext = require('../utils/securityEventContext');
const { consumeToken } = require('./tokenBucket');
const { resolvePolicy } = require('./rateLimitPolicy');

// Built-in identity resolvers — cover every dimension the brief's "Identity
// Strategy" section calls for. A route passes one of these (or its own
// function matching the same shape) as `keyResolver`.
//
// Every resolver returns `${type}:${value}` so tokenBucket.js's key becomes
// rl:v1:<policyName>:<type>:<value> — e.g. rl:v1:AUTH:user:64f...,
// rl:v1:AUTH:ip:203.0.113.4. The type prefix is what lets two different
// identity dimensions on the SAME policy never collide, and is also the
// only thing logged on a Redis error (never the raw identifier itself —
// see tokenBucket.js's keyType field).
const byUser = (req) => `user:${req.user.id}`;
// req.ip is already resolved correctly for the deployment's real proxy
// topology by Express's own trust-proxy handling (see init.js's
// app.set('trust proxy', ...) and securityEventContext.js's own comment on
// why nothing in this codebase reads X-Forwarded-For directly) — reusing
// it here, not re-deriving it, keeps this limiter consistent with every
// other IP-based decision already made elsewhere in the app.
const byIp = (req) => `ip:${req.ip}`;
// Authenticated routes should key on the real user, never the IP (many
// legitimate users can share one IP — brief's explicit warning); routes
// that can be hit unauthenticated must fall back to IP, since there's no
// other identity to key on.
const byUserOrIp = (req) => (req.user ? byUser(req) : byIp(req));

const KeyResolvers = { byUser, byIp, byUserOrIp };

// Never let raw Redis internals, implementation details, or token counts
// leak to a caller — the brief is explicit about this. The response shape
// is the one the brief itself specifies.
const sendRateLimited = (res, retryAfterSeconds) => {
  const safeRetryAfter = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : 1;
  res.set('Retry-After', String(safeRetryAfter));
  return res.status(429).json({
    status: 'error',
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again later.',
    retryAfter: safeRetryAfter,
  });
};

// createTokenBucketLimiter({ policyName, keyResolver, cost }) -> Express
// middleware. `policyName` must be a key in rateLimitPolicy.js's POLICIES.
// `keyResolver` defaults to byUserOrIp (the safest general default per the
// brief's identity-strategy guidance); pass KeyResolvers.byIp explicitly
// for routes that must never trust an authenticated identity (e.g. invite
// preview, which is intentionally unauthenticated).
const createTokenBucketLimiter = ({ policyName, keyResolver = byUserOrIp, cost = 1 }) => {
  // Fail fast at require-time, not on the first request — a typo'd
  // policyName should break startup, not silently no-op in production.
  resolvePolicy(policyName);

  return async (req, res, next) => {
    const policy = resolvePolicy(policyName);
    const identity = keyResolver(req);

    const result = await consumeToken({
      policyName,
      identity,
      capacity: policy.capacity,
      refillRate: policy.refillRate,
      cost,
    });

    if (result.redisAvailable === false) {
      // Fail-closed posture (see rateLimitPolicy.js's FAIL_CLOSED comment
      // for why this applies uniformly) — a Redis outage must never
      // silently become "unlimited traffic," which is exactly the old
      // MemoryStore-without-Redis failure mode this migration exists to
      // remove. The process itself never crashes (consumeToken already
      // caught the Redis error); this is a controlled, observable 429.
      logger.warn(
        { route: req.originalUrl, limiter: policyName, keyType: identity.split(':')[0], redisError: result.error },
        'rate_limit_fail_closed_redis_unavailable',
      );
      return sendRateLimited(res, 5);
    }

    if (!result.allowed) {
      SecurityEventService.record({
        type: 'RATE_LIMIT_TRIGGERED',
        severity: 'medium',
        actor: req.user ? { userId: req.user.id } : {},
        source: securityEventContext(req),
        target: { resource: req.originalUrl, action: policyName },
        result: 'blocked',
        metadata: { limiter: policyName },
      });
      return sendRateLimited(res, result.retryAfterSeconds);
    }

    return next();
  };
};

module.exports = { createTokenBucketLimiter, KeyResolvers };
