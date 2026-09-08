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
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      // Reconnect with capped backoff for the client's whole lifetime.
      // Previously this was `() => null` (no reconnect at all) — which meant
      // one Redis blip (a Render free-tier hibernation wake, an Upstash
      // maintenance window, any transient network drop) permanently killed
      // quota enforcement and dedup for the rest of the process's life: the
      // dead client stayed cached here, every command threw, and every
      // caller's catch fell open. A bounded reconnect keeps the initial
      // connect from hanging boot (connectTimeout above still bounds that)
      // while letting the client actually recover afterwards.
      retryStrategy: (times) => Math.min(times * 200, 5000),
      reconnectOnError: () => true,
      lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Zeph AI Redis client error'));
    client.on('reconnecting', () => logger.info('Zeph AI Redis client reconnecting'));
    // Kick off the connection now rather than waiting for the first command,
    // so the reconnect machinery is live before any quota/dedup call.
    client.connect().catch((err) => logger.warn({ err }, 'Zeph AI Redis initial connect failed — will retry'));
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
