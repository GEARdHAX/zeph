const fs = require('fs');
const path = require('path');
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
    // the test suite: retryStrategy:()=>null (set inside the module) bounds
    // the INITIAL connect attempt specifically. maxRetriesPerRequest is
    // deliberately NOT set here (see the module's Phase 8 comment) — that's
    // a separate, later-lifetime concern (a mid-operation outage after a
    // successful boot), not what bounds this particular connect-time test.
    const result = await setupRedisAdapter(fakeIo, 'redis://127.0.0.1:1');

    expect(result).toBe(false);
  }, 15000);

  // Phase 8 failure-injection finding, reproduced against a real local
  // Redis: a mid-operation outage (Redis process killed while the backend
  // was running, connection already established) crashed the ENTIRE
  // backend process — an uncaught `MaxRetriesPerRequestError`, NOT a
  // graceful degradation. Root cause: @socket.io/redis-adapter's internal
  // pubClient.publish(...) calls (dist/index.js) are fire-and-forget with
  // no .catch() of their own; with maxRetriesPerRequest set to a bounded
  // number, a command issued during the outage exhausts its retry budget
  // and rejects — an unhandled promise rejection Node's default behavior
  // turns into a full process crash. Confirmed via a real local Redis
  // kill + live socket-auth attempt: crashed with the old code (bounded
  // maxRetriesPerRequest), survived (degraded, not crashed) after removing
  // it. This test can't reproduce the live-kill scenario itself (it needs
  // a real spawned Redis process, out of scope for a unit test) — it
  // guards the actual root cause directly: the long-lived adapter clients
  // must never be constructed with a bounded maxRetriesPerRequest, mirroring
  // queues/connection.js's own BullMQ client (maxRetriesPerRequest:null)
  // for exactly the same documented reason.
  it('never sets a bounded maxRetriesPerRequest on the long-lived adapter clients (the exact config that crashed the process)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/setupRedisAdapter.js'), 'utf8');
    expect(source).not.toMatch(/maxRetriesPerRequest\s*:\s*\d/);
  });
});
