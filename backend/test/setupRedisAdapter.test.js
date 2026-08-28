const setupRedisAdapter = require('../src/setupRedisAdapter');

// Best-effort by design (see DECISIONS.md D-035, setupRedisAdapter.js's own
// comment) — REDIS_URL unset or unreachable must never crash the server,
// only fall back to single-process Socket.IO delivery. These tests cover
// exactly that contract without depending on a real Redis instance (no
// mock library added — the two failure-mode paths are fully exercisable
// with a fake io object and a garbage/unreachable URL).
describe('setupRedisAdapter', () => {
  it('is a no-op and returns false when redisUrl is not set', async () => {
    const adapterCalls = [];
    const fakeIo = { adapter: (...args) => adapterCalls.push(args) };

    const result = await setupRedisAdapter(fakeIo, null);

    expect(result).toBe(false);
    expect(adapterCalls).toHaveLength(0);
  });

  it('is a no-op and returns false when redisUrl is an empty string', async () => {
    const fakeIo = { adapter: () => { throw new Error('should not be called'); } };
    const result = await setupRedisAdapter(fakeIo, '');
    expect(result).toBe(false);
  });

  it('returns false (never throws) when the Redis connection fails', async () => {
    const fakeIo = { adapter: () => { throw new Error('should not be called — connection never succeeded'); } };

    // Port 1 is reserved/unroutable — ioredis fails fast rather than hanging
    // the test suite, and maxRetriesPerRequest:3 (set inside the module)
    // keeps any retry loop bounded.
    const result = await setupRedisAdapter(fakeIo, 'redis://127.0.0.1:1');

    expect(result).toBe(false);
  }, 15000);
});
