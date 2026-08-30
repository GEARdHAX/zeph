const IORedis = require('ioredis');
const store = require('../../store');
const logger = require('../../logger');

// A SEVENTH independent ioredis client (adapter/BullMQ/user-profile-cache/
// zero-trust-risk-cache/threat-intel-cache/ebpf-dedup/this — same
// established one-client-per-concern convention every prior phase's Redis
// usage follows). Backs Phase 5's sliding-window counters (spec section 27:
// "use Redis for short-lived flow counters... do not maintain infinite
// history in memory") and the destination baseline (spec section 22-23).
let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null, lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Network intel Redis error'));
  }
  return client;
};

const closeNetworkIntelConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = { getClient, closeNetworkIntelConnection };
