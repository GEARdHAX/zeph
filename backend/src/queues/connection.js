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
    // ioredis's quit() only sends QUIT once the socket reaches "ready" —
    // for a client stuck retrying a dead/unreachable address it never gets
    // there, so quit() neither resolves NOR rejects and the .catch()
    // fallback below never runs. Race it against a hard disconnect() so a
    // never-connected client can't hang shutdown/test-teardown forever.
    const conn = connection;
    await Promise.race([
      conn.quit().catch(() => {}),
      new Promise((resolve) => { setTimeout(() => { conn.disconnect(); resolve(); }, 500); }),
    ]);
    connection = null;
  }
};

module.exports = { getQueueConnection, closeQueueConnection };
