// Zeph AI's own ioredis client — same one-client-per-concern convention as
// securityAi/cache.js / threatIntel/quota.js (a ninth independent client
// alongside adapter/BullMQ/user-profile-cache/zero-trust/threat-intel/ebpf/
// network-intel/security-ai). Shared by quota.js, dedup.js and
// summaryCache.js below so Zeph AI opens exactly one extra connection, not
// three.
const IORedis = require('ioredis');
const store = require('../store');
const logger = require('../logger');

let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null, lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Zeph AI Redis client error'));
  }
  return client;
};

const closeAiRedisConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = { getClient, closeAiRedisConnection };
