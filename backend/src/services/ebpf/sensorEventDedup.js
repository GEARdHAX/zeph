const IORedis = require('ioredis');
const store = require('../../store');
const logger = require('../../logger');

// Idempotency (spec section 19) — a FIFTH independent ioredis client
// (adapter/BullMQ/Zero-Trust-risk-cache/threat-intel-cache/this — same
// one-client-per-concern convention every prior phase established).
// SET NX with a TTL doubles as both "have I seen this sensorEventId
// before" AND automatic cleanup — no separate expiry job needed.
const DEDUP_PREFIX = 'ebpf:dedup:';
const DEDUP_TTL_SECONDS = 24 * 60 * 60; // 24h — comfortably longer than any realistic retry/redelivery window (spec section 18's bounded retries complete in seconds/minutes, not hours), short enough that this Redis usage never approaches "permanent event stream storage" (spec section 42 explicitly warns against that)

let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null, lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'eBPF dedup cache Redis error'));
  }
  return client;
};

// Returns true if this (sensorId, sensorEventId) pair is genuinely NEW
// (safe to process) — false if it's a duplicate OR if Redis is
// unavailable. Fail-safe direction matters here: with no Redis, this
// module cannot tell duplicate from new, so it conservatively treats
// EVERY event as "already seen" (skip processing) rather than risk
// double-counting a flood of retried events into SecurityEvent/risk
// scoring — spec section 60's "never trust blindly" extends to "never
// blindly process when idempotency can't be verified." A dropped-instead-
// of-duplicated event is the safer failure mode for a TELEMETRY signal
// (a missed observation is far less costly than an artificially inflated
// one feeding the risk engine).
const claimEventOnce = async (sensorId, sensorEventId) => {
  const redis = getClient();
  if (!redis) return false;
  const key = `${DEDUP_PREFIX}${sensorId}:${sensorEventId}`;
  try {
    const result = await redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch (err) {
    logger.warn({ err, sensorId, sensorEventId }, 'ebpf_dedup_check_failed');
    return false;
  }
};

const closeSensorDedupConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = { claimEventOnce, closeSensorDedupConnection };
