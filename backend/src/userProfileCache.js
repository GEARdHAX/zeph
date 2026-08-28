const IORedis = require('ioredis');
const store = require('./store');
const logger = require('./logger');

// Cache-aside for the public profile fields users/resolve.js looks up by
// username — the ONE genuinely safe caching target evaluated this pass.
// Deliberately NOT caching group membership/authorization lookups
// (groupPolicy.getMembership et al.) — a stale entry there could let a
// removed/banned member act as active for the TTL window, a real security
// regression. Profile data (name/avatar/bio) changing a few seconds late is
// purely cosmetic. See DECISIONS.md.
//
// Best-effort, same posture as setupRedisAdapter.js/queues/connection.js:
// no REDIS_URL, or Redis genuinely down, means every call falls through to
// the real DB query — a cache outage degrades to "no caching," never an
// app-breaking error.
const CACHE_PREFIX = 'profile:';
const TTL_SECONDS = 5 * 60; // short TTL as a safety net for any invalidation gap, not the primary correctness mechanism — explicit invalidateProfileCache() calls are that.

let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null, lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'User profile cache Redis error'));
  }
  return client;
};

const cacheKey = (usernameNormalized) => `${CACHE_PREFIX}${usernameNormalized}`;

// fetchFn: () => Promise<profileObject|null> — the real Mongo query,
// invoked on a cache miss OR whenever Redis itself is unavailable.
const getCachedProfile = async (usernameNormalized, fetchFn) => {
  const redis = getClient();
  if (!redis) return fetchFn();

  try {
    const cached = await redis.get(cacheKey(usernameNormalized));
    if (cached !== null) return JSON.parse(cached);
  } catch (err) {
    logger.warn({ err, usernameNormalized }, 'Failed to read user profile cache, falling back to DB');
  }

  const fresh = await fetchFn();
  if (fresh) {
    redis.set(cacheKey(usernameNormalized), JSON.stringify(fresh), 'EX', TTL_SECONDS)
      .catch((err) => logger.warn({ err, usernameNormalized }, 'Failed to write user profile cache'));
  }
  return fresh;
};

// Called from every route that mutates a cached field (see
// DECISIONS.md's write-point list) — usernames are passed lowercase
// already normalized, or raw (this lowercases defensively either way).
const invalidateProfileCache = async (usernameNormalized) => {
  if (!usernameNormalized) return;
  const redis = getClient();
  if (!redis) return;
  await redis.del(cacheKey(usernameNormalized.toLowerCase())).catch((err) => logger.warn({ err, usernameNormalized }, 'Failed to invalidate user profile cache'));
};

// Test-only escape hatch — same reasoning as queues/connection.js's
// closeQueueConnection: without an explicit close, a test file that
// exercises the real Redis path leaves this module's singleton connection
// open past the test run (Jest's "did not exit" warning).
const closeProfileCacheConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = { getCachedProfile, invalidateProfileCache, closeProfileCacheConnection };
