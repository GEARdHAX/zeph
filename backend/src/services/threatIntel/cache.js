const IORedis = require('ioredis');
const store = require('../../store');
const logger = require('../../logger');

// A FOURTH independent ioredis client (adapter/BullMQ/Zero-Trust-risk-cache/
// this — same established one-client-per-concern convention every prior
// phase's Redis usage already follows; see riskCache.js's own comment for
// the reasoning this copies verbatim).
//
// Negative caching (spec section 6 of the user's hardening addendum) is the
// whole point of this file: EVERY result (CLEAN, MALICIOUS, and even a
// provider failure's UNKNOWN) gets cached, not just malicious hits — an
// attacker whose IP happens to be clean must not be able to force a fresh
// provider call on every single request just by having a "boring" IP.
const CACHE_PREFIX = 'threatintel:ip:'; // key names generalize past IP by construction (indicatorKey already namespaces by type), prefix says "ip" only because that's this phase's one real indicator type per the user's provider decision

let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null, lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Threat intel cache Redis error'));
  }
  return client;
};

const cacheKey = (indicatorKey) => `${CACHE_PREFIX}${indicatorKey}`;

// Redis unavailable -> null (cache miss shape the caller already handles),
// never thrown — same fail-safe posture as every other Redis-backed module
// in this codebase (userProfileCache.js, riskCache.js).
const getCachedThreatResult = async (indicatorKey) => {
  const redis = getClient();
  if (!redis) return null;
  try {
    const cached = await redis.get(cacheKey(indicatorKey));
    return cached !== null ? JSON.parse(cached) : null;
  } catch (err) {
    logger.warn({ err, indicatorKey }, 'Failed to read threat intel cache, treating as miss');
    return null;
  }
};

// ttlSeconds is the caller's responsibility (ThreatIntelService.js passes
// config.threatIntelCacheTtlSeconds) — this module has no opinion on what a
// "reasonable" TTL is, only how to store one.
const setCachedThreatResult = async (indicatorKey, result, ttlSeconds) => {
  const redis = getClient();
  if (!redis) return;
  await redis.set(cacheKey(indicatorKey), JSON.stringify(result), 'EX', ttlSeconds)
    .catch((err) => logger.warn({ err, indicatorKey }, 'Failed to write threat intel cache'));
};

const closeThreatIntelCacheConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = {
  getCachedThreatResult, setCachedThreatResult, closeThreatIntelCacheConnection, getClient,
};
