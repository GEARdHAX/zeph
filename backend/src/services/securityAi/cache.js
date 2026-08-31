const crypto = require('crypto');
const IORedis = require('ioredis');
const store = require('../../store');
const logger = require('../../logger');

// An EIGHTH independent ioredis client (adapter/BullMQ/user-profile-cache/
// zero-trust-risk-cache/threat-intel-cache/ebpf-dedup/network-intel — same
// established one-client-per-concern convention every prior phase's Redis
// usage follows). Short-lived result cache only (spec section 20: "never
// cache in a way that causes stale security decisions... AI results are
// advisory") — this is a performance optimization for repeated identical
// contexts within a short window, never a source of authority.
let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null, lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Security AI cache Redis error'));
  }
  return client;
};

const CACHE_PREFIX = 'securityai:result:';

// Stable hash of the analysisType + sanitized context (+ an OPTIONAL
// scopeId — see below) — the cache key itself never contains raw context
// data (spec section 65: "do not store massive AI contexts permanently in
// Redis" — this stores neither massive nor permanent; the VALUE is the
// small structured result, TTL-bounded).
//
// scopeId exists to fix a real bug found in testing: sanitizeContext()
// deliberately never includes userId/sensorId in the CONTEXT sent to the
// model (an identifier adds nothing to the model's reasoning about a
// behavioral PATTERN, and keeping identifiers out of prompts is worth
// doing on principle even for a local model) — but that means two
// DIFFERENT users/hosts who happen to produce the exact same aggregate
// counts (e.g. both failedLoginCount:0) would otherwise collide on the
// SAME cache entry and silently share one user's AI verdict with another.
// scopeId is mixed into the KEY only, never into the context object that
// gets JSON.stringify'd into the prompt — callers that need per-identity
// isolation (riskEngine.js's per-user AI signal read) pass their userId/
// sensorId here; callers analyzing an already-aggregated, non-identity-
// specific incident (the BullMQ worker's INCIDENT_SUMMARY calls) can omit
// it, since an incident's correlationKey already IS its own identity.
const contextHash = (analysisType, context, scopeId = '') => crypto.createHash('sha256')
  .update(`${analysisType}:${scopeId}:${JSON.stringify(context)}`)
  .digest('hex');

const getCachedAnalysis = async (analysisType, context, scopeId) => {
  const redis = getClient();
  if (!redis) return null;
  try {
    const key = `${CACHE_PREFIX}${contextHash(analysisType, context, scopeId)}`;
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    logger.warn({ err }, 'Failed to read security AI cache, treating as miss');
    return null;
  }
};

const setCachedAnalysis = async (analysisType, context, result, ttlSeconds, scopeId) => {
  const redis = getClient();
  if (!redis) return;
  const key = `${CACHE_PREFIX}${contextHash(analysisType, context, scopeId)}`;
  await redis.set(key, JSON.stringify(result), 'EX', ttlSeconds)
    .catch((err) => logger.warn({ err }, 'Failed to write security AI cache'));
};

const closeSecurityAiCacheConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = {
  getCachedAnalysis, setCachedAnalysis, closeSecurityAiCacheConnection, getClient, contextHash,
};
