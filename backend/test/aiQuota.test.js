const store = require('../src/store');
const config = require('../config');
const {
  checkQuota,
  recordUsage,
  acquireConcurrency,
  releaseConcurrency,
  secondsUntilUtcMidnight,
  buildReset,
} = require('../src/ai/quota');

// Same convention as test/helpers/app.js: tests never touch a real external
// Redis. checkQuota/recordUsage/acquireConcurrency/releaseConcurrency all
// fail OPEN when getClient() returns null (no REDIS_URL configured) — this
// is the one behavior verifiable without a live Redis instance, matching
// how every other Redis-backed module in this codebase (threatIntel/quota.js,
// securityAi/cache.js) is tested at the unit level.
beforeAll(() => {
  store.config = { ...config, redisUrl: null };
});

describe('checkQuota — no Redis configured (fails open)', () => {
  it('allows the request — a missing quota backend must not itself block AI', async () => {
    const result = await checkQuota({ userId: 'u1', ip: '127.0.0.1', config: store.config });
    expect(result.allowed).toBe(true);
  });
});

describe('recordUsage — no Redis configured', () => {
  it('is a no-op that resolves without throwing', async () => {
    await expect(recordUsage({ userId: 'u1', ip: '127.0.0.1' })).resolves.toBeUndefined();
  });
});

describe('acquireConcurrency / releaseConcurrency — no Redis configured', () => {
  it('are no-ops that resolve without throwing', async () => {
    await expect(acquireConcurrency('u1')).resolves.toBeUndefined();
    await expect(releaseConcurrency('u1')).resolves.toBeUndefined();
  });
});

describe('quota reset-time math (for the "come back in X" toast)', () => {
  it('secondsUntilUtcMidnight is a positive number under 24h', () => {
    const s = secondsUntilUtcMidnight();
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('buildReset uses the Redis TTL when it is a positive number', () => {
    const { retryAfter, resetAt } = buildReset(42, 60);
    expect(retryAfter).toBe(42);
    expect(new Date(resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('buildReset falls back when the TTL is missing/-1/-2', () => {
    expect(buildReset(-1, 60).retryAfter).toBe(60);
    expect(buildReset(-2, 15).retryAfter).toBe(15);
    expect(buildReset(0, 10).retryAfter).toBe(10);
    expect(buildReset(null, 30).retryAfter).toBe(30);
  });

  it('buildReset resetAt is roughly retryAfter seconds in the future', () => {
    const before = Date.now();
    const { resetAt } = buildReset(120, 60);
    const delta = new Date(resetAt).getTime() - before;
    expect(delta).toBeGreaterThan(118 * 1000);
    expect(delta).toBeLessThan(122 * 1000);
  });
});
