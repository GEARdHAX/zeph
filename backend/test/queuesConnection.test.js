// Regression: getQueueConnection()'s shared ioredis client had no 'error'
// listener — every other Redis client in this app (ai/redisClient.js,
// lib/rateLimitClient.js, setupRedisAdapter.js) already has one. Without a
// listener, ioredis emits an uncaught 'error' event for every failed
// command, which is exactly what happened when Upstash's free-tier
// monthly request quota was exceeded: BullMQ's internal polling kept
// re-issuing commands, each one erroring, each one printing a raw
// unstructured stack trace straight to stdout — hundreds per second,
// drowning out this app's own structured pino logs.
const store = require('../src/store');
const config = require('../config');
const { getQueueConnection, closeQueueConnection, createQueue } = require('../src/queues/connection');

afterEach(async () => {
  await closeQueueConnection();
});

describe('getQueueConnection — error handling', () => {
  it('returns null when no Redis is configured (no client created at all)', () => {
    store.config = { ...config, redisUrl: null };
    expect(getQueueConnection()).toBeNull();
  });

  it('attaches at least one error listener to the shared connection, so a Redis error never becomes an uncaught exception', () => {
    store.config = { ...config, redisUrl: 'redis://127.0.0.1:1' }; // unreachable on purpose — never actually connects
    const connection = getQueueConnection();

    expect(connection).not.toBeNull();
    expect(connection.listenerCount('error')).toBeGreaterThan(0);

    // Directly prove the fix: emitting 'error' with a listener attached
    // must NOT throw/crash the process (this is exactly what ioredis does
    // by default with ZERO listeners — Node treats an unhandled EventEmitter
    // 'error' event as fatal).
    expect(() => connection.emit('error', new Error('simulated Redis failure'))).not.toThrow();
  });

  it('reuses the same connection across multiple calls (memoized, not reconnecting per call)', () => {
    store.config = { ...config, redisUrl: 'redis://127.0.0.1:1' };
    const first = getQueueConnection();
    const second = getQueueConnection();
    expect(first).toBe(second);
  });
});

// Follow-up regression: BullMQ's Queue is its OWN EventEmitter, separate
// from the shared ioredis connection above. aiQueue/groupCleanup/
// meetingAiQueue/securityAiQueue each built `new Queue(...)` directly with
// no 'error' listener, so the same unhandled-EventEmitter-error crash this
// file originally guarded against also applied one layer up, at the Queue
// level — e.g. a script/command failure (same Redis-quota-exhaustion case)
// emits 'error' on the Queue instance itself, not just the connection.
describe('createQueue — error handling', () => {
  let queue;

  afterEach(async () => {
    if (queue) await queue.close();
    queue = undefined;
  });

  it('attaches an error listener to the Queue instance, so a Queue-level error never becomes an uncaught exception', () => {
    store.config = { ...config, redisUrl: 'redis://127.0.0.1:1' };
    const connection = getQueueConnection();
    queue = createQueue('test-queue', connection);

    expect(queue.listenerCount('error')).toBeGreaterThan(0);
    expect(() => queue.emit('error', new Error('simulated queue failure'))).not.toThrow();
  });
});
