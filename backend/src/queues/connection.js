const IORedis = require('ioredis');
const store = require('../store');
const logger = require('../logger');

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
    // Every other Redis client in this app (ai/redisClient.js,
    // lib/rateLimitClient.js, setupRedisAdapter.js) already has this — this
    // one didn't. Without a listener, ioredis's default behavior on an
    // 'error' event with zero listeners is to throw it as an uncaught
    // exception, and BullMQ's own internal polling (Worker/QueueEvents
    // re-issuing their blocking commands on a fixed short interval) was
    // hitting this on every single poll once Redis started rejecting
    // commands (e.g. Upstash's free-tier monthly request cap), producing
    // hundreds of raw, unstructured ReplyError stack traces per second
    // straight to stdout — drowning out every other log line (including
    // this app's own structured pino output) until the underlying Redis
    // issue cleared. This does not fix BullMQ's polling cadence itself
    // (that's internal to the library, and backing off further than its
    // default would slow legitimate job pickup under normal operation) —
    // it only ensures the errors are logged once, structured, through the
    // same pino pipeline every other Redis client already uses, instead of
    // flooding raw stack traces.
    connection.on('error', (err) => logger.warn({ err }, 'BullMQ Redis connection error'));
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
      new Promise((resolve) => {
        setTimeout(() => {
          conn.disconnect();
          resolve();
        }, 500);
      }),
    ]);
    connection = null;
  }
};

module.exports = { getQueueConnection, closeQueueConnection };
