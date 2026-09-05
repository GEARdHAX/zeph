const store = require('../src/store');
const config = require('../config');
const {
  checkQuota, recordUsage, acquireConcurrency, releaseConcurrency,
} = require('../src/ai/quota');

// Same convention as test/helpers/app.js: tests never touch a real external
// Redis. checkQuota/recordUsage/acquireConcurrency/releaseConcurrency all
// fail OPEN when getClient() returns null (no REDIS_URL configured) — this
// is the one behavior verifiable without a live Redis instance, matching
// how every other Redis-backed module in this codebase (threatIntel/quota.js,
// securityAi/cache.js) is tested at the unit level.
beforeAll(() => { store.config = { ...config, redisUrl: null }; });

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
