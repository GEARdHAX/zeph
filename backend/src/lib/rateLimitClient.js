// Dedicated ioredis client for the distributed token-bucket rate limiter —
// same one-client-per-concern convention as ai/redisClient.js (a tenth
// independent client alongside adapter/BullMQ/user-profile-cache/zero-trust/
// threat-intel/ebpf/network-intel/security-ai/zeph-ai). Kept separate from
// ai/redisClient.js on purpose: HTTP rate limiting and AI quota are
// different concerns with different failure postures (rate limiting here
// fails CLOSED on a Redis error — see tokenBucket.js — while AI quota
// deliberately fails OPEN), so sharing a client would make one subsystem's
// Redis health silently depend on sharing load with the other's.
const IORedis = require('ioredis');
const store = require('../store');
const logger = require('../logger');

// Reads rateLimitRedisUrl, falling back to the shared redisUrl — in every
// real deployment these are the same Redis instance (config.js defaults
// rateLimitRedisUrl to redisUrl unless explicitly overridden), so this
// never needs a second env var in practice. The separate config key exists
// purely so test files can opt this ONE subsystem into a real Redis
// connection (rate limiting now fails closed without one, unlike every
// other optional Redis-backed feature in this codebase) without also
// waking up BullMQ/the Socket.IO adapter/every other subsystem that reads
// the shared redisUrl — see test/helpers/app.js.
let client = null;
const getClient = () => {
  const url = store.config?.rateLimitRedisUrl || store.config?.redisUrl;
  if (!url) return null;
  if (!client) {
    client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      // Same bounded-reconnect reasoning as ai/redisClient.js — a transient
      // Redis blip must not permanently wedge this client into "always
      // throws" for the rest of the process's life.
      retryStrategy: (times) => Math.min(times * 200, 5000),
      reconnectOnError: () => true,
      lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Rate limit Redis client error'));
    client.on('reconnecting', () => logger.info('Rate limit Redis client reconnecting'));
    client.connect().catch((err) => logger.warn({ err }, 'Rate limit Redis initial connect failed — will retry'));
  }
  return client;
};

const closeRateLimitConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = { getClient, closeRateLimitConnection };
