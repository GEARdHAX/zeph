const IORedis = require('ioredis');
const { Queue } = require('bullmq');
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

// BullMQ's Worker/QueueEvents hold a blocking connection and retry their
// blocking command roughly every 30ms while it keeps failing (e.g. Upstash's
// quota-exceeded case) — a plain listener logs one warn-level line per
// retry, ~30/sec per queue, drowning stdout even after the command-args
// redact fix (logger.js) shrank each individual line. logger.throttledWarn
// collapses that to one line per key per window.
const THROTTLE_WINDOW_MS = 30000;

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
    // it only ensures the errors are logged once, structured (and now
    // throttled — see throttledWarn above), through the same pino pipeline
    // every other Redis client already uses, instead of flooding raw stack
    // traces or a warn line per ~30ms retry.
    connection.on('error', (err) =>
      logger.throttledWarn('connection', THROTTLE_WINDOW_MS, { err }, 'BullMQ Redis connection error'),
    );
  }
  return connection;
};

// BullMQ's Queue is its OWN EventEmitter, separate from the shared ioredis
// connection above — a script/command failure (e.g. the same Redis-quota
// exhaustion getQueueConnection's listener guards against) also emits
// 'error' on the Queue instance itself. Every queue file
// (aiQueue/groupCleanup/meetingAiQueue/securityAiQueue) built its own `new
// Queue(...)` with no listener, so the exact same "unhandled EventEmitter
// error crashes/dumps raw" failure mode applied one layer up, printing raw
// Lua-script/command dumps straight to stdout. One shared constructor fixes
// all four call sites at once instead of patching each file.
const createQueue = (name, connection) => {
  const queue = new Queue(name, { connection });
  queue.on('error', (err) =>
    logger.throttledWarn(`queue:${name}`, THROTTLE_WINDOW_MS, { err, queue: name }, 'BullMQ queue error'),
  );
  return queue;
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

module.exports = { getQueueConnection, closeQueueConnection, createQueue };
