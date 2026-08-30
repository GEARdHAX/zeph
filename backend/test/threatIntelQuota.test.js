require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const { checkAndReserveBudget, recordProviderRateLimit } = require('../src/services/threatIntel/quota');
const { closeThreatIntelCacheConnection, getClient } = require('../src/services/threatIntel/cache');
const logger = require('../src/logger');

describe('threatIntel quota — no Redis configured', () => {
  it('allows the call (fails open on the quota check only) when Redis is unavailable', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const result = await checkAndReserveBudget(800);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeNull();
    store.config = original;
  });
});

describe('threatIntel quota — recordProviderRateLimit', () => {
  it('does nothing when rateLimit is null', () => {
    expect(() => recordProviderRateLimit(null)).not.toThrow();
  });

  it('logs a warning when the provider reports a low remaining count', () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    recordProviderRateLimit({ remaining: 5, limit: 1000, retryAfterSeconds: null });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimit: expect.objectContaining({ remaining: 5 }) }),
      'abuseipdb_quota_low',
    );
    warnSpy.mockRestore();
  });

  it('does not warn when remaining is comfortably high', () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    recordProviderRateLimit({ remaining: 500, limit: 1000, retryAfterSeconds: null });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('threatIntel quota — real Redis (spec sections 9-11)', () => {
  const testDateKey = `threatintel:quota:abuseipdb:${new Date().toISOString().slice(0, 10)}`;

  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterEach(async () => {
    const redis = getClient();
    if (redis) await redis.del(testDateKey);
  });

  afterAll(async () => {
    await closeThreatIntelCacheConnection();
  });

  it('allows calls under the budget and reports remaining count', async () => {
    // Not asserting an exact remaining count — this key is scoped per UTC
    // DAY (quota.js's own design), and other test FILES running
    // concurrently in separate Jest workers legitimately share the same
    // real Redis instance and the same "today" key (there is deliberately
    // no per-test-run namespace — that's not how the real quota key is
    // shaped in production either). afterEach's del() below keeps THIS
    // file's own tests isolated from each other; it can't isolate against
    // a sibling file incrementing the same key mid-run.
    const result = await checkAndReserveBudget(800);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThan(800);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it('denies calls once the budget is reached', async () => {
    const budget = 3;
    let last;
    for (let i = 0; i < budget + 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await checkAndReserveBudget(budget);
    }
    expect(last.allowed).toBe(false);
    expect(last.remaining).toBe(0);
  });

  it('never exceeds the budget under concurrent simultaneous requests (atomic INCR)', async () => {
    const budget = 10;
    const results = await Promise.all(Array.from({ length: 25 }, () => checkAndReserveBudget(budget)));
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(budget); // exactly the budget, never more, even with 25 racing requests
  });
});
