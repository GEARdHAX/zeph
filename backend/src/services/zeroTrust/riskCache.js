const IORedis = require('ioredis');
const store = require('../../store');
const logger = require('../../logger');

// Short-lived per-session risk signal cache (spec section 8/19/31) — the
// "10 failed logins recently" / "rate-limit event just happened" kind of
// signal that would otherwise mean a fresh MongoDB SecurityEvent query on
// every single sensitive request. Same best-effort posture as
// userProfileCache.js (the direct template this copies): no REDIS_URL, or
// Redis genuinely down, degrades to "recompute the risk-relevant counters
// from Mongo every time" — never an app-breaking error, and per spec
// section 30, never a silent fail-open on a sensitive operation either
// (riskEngine.js is what enforces that policy, not this cache).
//
// A SEPARATE ioredis client from setupRedisAdapter.js/queues/connection.js/
// userProfileCache.js, by the same established convention (each concern
// gets its own client — BullMQ's blocking commands and the Socket.IO
// adapter's pub/sub can't share a connection with normal GET/SET traffic).
const CACHE_PREFIX = 'risk:';
const TTL_SECONDS = 5 * 60; // matches userProfileCache.js's TTL — long enough to actually save queries on a burst of sensitive requests, short enough that a real risk change (a fresh failed-login event) is never stale for long.

let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null, lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Zero Trust risk cache Redis error'));
  }
  return client;
};

const cacheKey = (sessionId) => `${CACHE_PREFIX}${sessionId}`;

// computeFn: () => Promise<riskContextObject> — the real signal computation
// (recent SecurityEvent counts etc.), invoked on a cache miss OR whenever
// Redis itself is unavailable.
const getCachedRiskContext = async (sessionId, computeFn) => {
  const redis = getClient();
  if (!redis || !sessionId) return computeFn();

  try {
    const cached = await redis.get(cacheKey(sessionId));
    if (cached !== null) return JSON.parse(cached);
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to read Zero Trust risk cache, recomputing');
  }

  const fresh = await computeFn();
  if (fresh) {
    redis.set(cacheKey(sessionId), JSON.stringify(fresh), 'EX', TTL_SECONDS)
      .catch((err) => logger.warn({ err, sessionId }, 'Failed to write Zero Trust risk cache'));
  }
  return fresh;
};

// Called whenever a NEW security-relevant event fires for this session
// (a failed login on this device, a permission-denied, a rate-limit trip)
// so the next request re-evaluates risk immediately rather than serving a
// stale low-risk verdict for up to TTL_SECONDS — spec section 19's
// "continuous session evaluation" requirement. Best-effort: if this fails,
// the cache simply expires naturally at its TTL instead of invalidating
// early, never an app-breaking error.
const invalidateRiskContext = async (sessionId) => {
  if (!sessionId) return;
  const redis = getClient();
  if (!redis) return;
  await redis.del(cacheKey(sessionId)).catch((err) => logger.warn({ err, sessionId }, 'Failed to invalidate Zero Trust risk cache'));
};

// Test-only escape hatch — same reasoning as queues/connection.js's
// closeQueueConnection / userProfileCache.js's closeProfileCacheConnection.
const closeRiskCacheConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = { getCachedRiskContext, invalidateRiskContext, closeRiskCacheConnection };
