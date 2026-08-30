require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const {
  getCachedThreatResult, setCachedThreatResult, closeThreatIntelCacheConnection,
} = require('../src/services/threatIntel/cache');

describe('threatIntel cache — Redis unavailable (test default, matches store.config.redisUrl=null)', () => {
  it('getCachedThreatResult returns null (a clean miss, not a throw) with no Redis configured', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const result = await getCachedThreatResult('some-key');
    expect(result).toBeNull();
    store.config = original;
  });

  it('setCachedThreatResult resolves without throwing when Redis is unavailable', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    await expect(setCachedThreatResult('some-key', { malicious: true }, 60)).resolves.toBeUndefined();
    store.config = original;
  });

  afterAll(async () => {
    await closeThreatIntelCacheConnection();
  });
});

// Real Redis, same describeIfRedis gate groupCleanup.test.js already
// established — skipped entirely (not failed) when REDIS_URL isn't set,
// e.g. in CI without the secret.
const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('threatIntel cache — real Redis', () => {
  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    await closeThreatIntelCacheConnection();
  });

  it('caches and retrieves a result, including a CLEAN (non-malicious) verdict — negative caching (spec section 6)', async () => {
    const key = `test-clean-${Date.now()}`;
    const cleanResult = {
      malicious: false, confidence: 0, severity: 'low', source: 'mock',
    };
    await setCachedThreatResult(key, cleanResult, 60);
    const retrieved = await getCachedThreatResult(key);
    expect(retrieved).toEqual(cleanResult);
  });

  it('caches a MALICIOUS verdict too', async () => {
    const key = `test-malicious-${Date.now()}`;
    const maliciousResult = {
      malicious: true, confidence: 92, severity: 'critical', source: 'mock',
    };
    await setCachedThreatResult(key, maliciousResult, 60);
    const retrieved = await getCachedThreatResult(key);
    expect(retrieved).toEqual(maliciousResult);
  });

  it('respects TTL — an expired entry is a miss', async () => {
    const key = `test-ttl-${Date.now()}`;
    await setCachedThreatResult(key, { malicious: false }, 1);
    await new Promise((resolve) => { setTimeout(resolve, 1200); });
    const retrieved = await getCachedThreatResult(key);
    expect(retrieved).toBeNull();
  });

  it('a miss for a never-cached key returns null', async () => {
    const retrieved = await getCachedThreatResult(`never-cached-${Date.now()}`);
    expect(retrieved).toBeNull();
  });
});
