require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const {
  tryAcquireLock, releaseLock, waitForResult,
} = require('../src/services/threatIntel/singleFlight');
const { setCachedThreatResult, getCachedThreatResult, closeThreatIntelCacheConnection } = require('../src/services/threatIntel/cache');

describe('threatIntel single-flight — no Redis configured', () => {
  it('tryAcquireLock returns undefined (distinct from null/"contended" — no coordination possible at all) rather than throwing', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const token = await tryAcquireLock('some-key');
    expect(token).toBeUndefined();
    store.config = original;
  });

  it('releaseLock resolves without throwing even with no token/no Redis', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    await expect(releaseLock('some-key', null)).resolves.toBeUndefined();
    store.config = original;
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('threatIntel single-flight — real Redis (spec sections 7-8: cache stampede protection)', () => {
  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    await closeThreatIntelCacheConnection();
  });

  it('a second concurrent lock attempt for the same key fails while the first holds it', async () => {
    const key = `test-lock-${Date.now()}`;
    const tokenA = await tryAcquireLock(key);
    const tokenB = await tryAcquireLock(key);
    expect(tokenA).not.toBeNull();
    expect(tokenB).toBeNull(); // exactly one caller wins — this is the single-flight guarantee
    await releaseLock(key, tokenA);
  });

  it('releasing the lock lets a subsequent caller acquire it', async () => {
    const key = `test-lock-release-${Date.now()}`;
    const tokenA = await tryAcquireLock(key);
    await releaseLock(key, tokenA);
    const tokenB = await tryAcquireLock(key);
    expect(tokenB).not.toBeNull();
    await releaseLock(key, tokenB);
  });

  it('releaseLock only releases if the token still matches (never deletes a lock it does not own)', async () => {
    const key = `test-lock-token-mismatch-${Date.now()}`;
    const realToken = await tryAcquireLock(key);
    await releaseLock(key, 'a-completely-different-token'); // wrong token — must be a no-op
    const stillHeld = await tryAcquireLock(key); // if the wrong-token release had worked, this would succeed
    expect(stillHeld).toBeNull();
    await releaseLock(key, realToken); // clean up with the real token
  });

  it('1,000 simultaneous lock attempts for the same indicator: exactly one wins (spec section 8, distilled)', async () => {
    const key = `test-stampede-${Date.now()}`;
    const attempts = await Promise.all(Array.from({ length: 1000 }, () => tryAcquireLock(key)));
    const winners = attempts.filter((t) => t !== null);
    expect(winners).toHaveLength(1);
    await releaseLock(key, winners[0]);
  });

  it('waitForResult returns the cached value once another "in-flight" lookup populates it', async () => {
    const key = `test-wait-${Date.now()}`;
    const expected = { malicious: true, confidence: 90 };
    setTimeout(() => { setCachedThreatResult(key, expected, 60); }, 200);

    const result = await waitForResult(key, getCachedThreatResult);
    expect(result).toEqual(expected);
  });

  it('waitForResult returns null if nothing populates the cache before its timeout', async () => {
    const key = `test-wait-timeout-${Date.now()}`;
    const result = await waitForResult(key, getCachedThreatResult);
    expect(result).toBeNull();
  }, 10000);
});
