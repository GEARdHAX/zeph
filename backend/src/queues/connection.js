const IORedis = require('ioredis');
const store = require('../store');

// Shared BullMQ connection factory — a SEPARATE ioredis client from
// setupRedisAdapter.js's pub/sub pair (BullMQ multiplexes blocking BRPOPLPUSH-
// style commands over its own connection and cannot share one with Socket.IO's
// adapter). maxRetriesPerRequest:null is BullMQ's own documented requirement
// (its internal blocking commands must not be retried/aborted by ioredis
// itself — BullMQ handles that at a higher level). Lazily created and
// memoized so every queue/worker in this app reuses one connection instead
// of opening a new socket each time this is required.
let connection = null;

const getQueueConnection = () => {
  if (!store.config?.redisUrl) return null;
  if (!connection) {
    connection = new IORedis(store.config.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
};

// Test-only escape hatch — the Jest test harness (test/helpers/app.js) sets
// store.config to the real config.js, which reads the real REDIS_URL from
// .env. Without this, every test that touches group/delete.js would
// silently connect to and enqueue jobs in a real external Redis instance,
// and leave that connection open past the test run (Jest's "did not exit"
// warning). Test files call this in an afterAll to guarantee a clean
// shutdown regardless of whether a connection was ever actually opened.
const closeQueueConnection = async () => {
  if (connection) {
    await connection.quit().catch(() => connection.disconnect());
    connection = null;
  }
};

module.exports = { getQueueConnection, closeQueueConnection };
