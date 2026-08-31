require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const {
  getCachedAnalysis, setCachedAnalysis, closeSecurityAiCacheConnection, contextHash,
} = require('../src/services/securityAi/cache');

describe('securityAi cache — Redis unavailable (test default)', () => {
  it('getCachedAnalysis returns null (a clean miss, not a throw) with no Redis configured', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const result = await getCachedAnalysis('ANOMALY', { failedLoginCount: 1 });
    expect(result).toBeNull();
    store.config = original;
  });

  it('setCachedAnalysis resolves without throwing when Redis is unavailable', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    await expect(setCachedAnalysis('ANOMALY', { failedLoginCount: 1 }, { anomalous: true }, 60)).resolves.toBeUndefined();
    store.config = original;
  });

  afterAll(async () => {
    await closeSecurityAiCacheConnection();
  });
});

describe('contextHash — scopeId isolation (regression: cross-user cache collision)', () => {
  it('produces the SAME hash for identical analysisType+context+scopeId', () => {
    const context = { failedLoginCount: 0 };
    expect(contextHash('ANOMALY', context, 'user-a')).toBe(contextHash('ANOMALY', { ...context }, 'user-a'));
  });

  it('produces DIFFERENT hashes for the same context but different scopeId — this is the fix for the real bug found in testing', () => {
    const context = { failedLoginCount: 0 };
    expect(contextHash('ANOMALY', context, 'user-a')).not.toBe(contextHash('ANOMALY', context, 'user-b'));
  });

  it('an omitted scopeId is treated consistently (not the same as an empty-string scopeId collision with a real user id)', () => {
    const context = { failedLoginCount: 0 };
    expect(contextHash('ANOMALY', context)).toBe(contextHash('ANOMALY', context, ''));
    expect(contextHash('ANOMALY', context)).not.toBe(contextHash('ANOMALY', context, 'user-a'));
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('securityAi cache — real Redis', () => {
  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    await closeSecurityAiCacheConnection();
  });

  it('caches and retrieves a result', async () => {
    const context = { failedLoginCount: `${Date.now()}` }; // unique per test run
    const result = { anomalous: true, confidence: 90 };
    await setCachedAnalysis('ANOMALY', context, result, 60, 'user-x');
    const retrieved = await getCachedAnalysis('ANOMALY', context, 'user-x');
    expect(retrieved).toEqual(result);
  });

  it('a different scopeId for the SAME context is a cache miss (the actual regression this fixes)', async () => {
    const context = { failedLoginCount: `${Date.now()}-2` };
    await setCachedAnalysis('ANOMALY', context, { anomalous: true }, 60, 'user-y');
    const retrievedForOtherUser = await getCachedAnalysis('ANOMALY', context, 'user-z');
    expect(retrievedForOtherUser).toBeNull();
  });

  it('respects TTL — an expired entry is a miss', async () => {
    const context = { failedLoginCount: `${Date.now()}-3` };
    await setCachedAnalysis('ANOMALY', context, { anomalous: false }, 1, 'user-w');
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    const retrieved = await getCachedAnalysis('ANOMALY', context, 'user-w');
    expect(retrieved).toBeNull();
  });
});
