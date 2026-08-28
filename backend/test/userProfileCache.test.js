require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const { getCachedProfile, invalidateProfileCache, closeProfileCacheConnection } = require('../src/userProfileCache');

// Exercises the real Redis instance from .env (same one verified working by
// setupRedisAdapter.test.js/groupCleanup.test.js) — the module's own
// getClient() is a private singleton with no exposed close(), so rather
// than duplicate that internal wiring here, this reuses the SAME env-driven
// config every other Redis-backed test this session already established as
// the project's pattern for "prove the real infra path, not just a mock".
const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describe('getCachedProfile — no Redis configured', () => {
  it('always calls fetchFn and never throws when redisUrl is unset', async () => {
    store.config = { ...config, redisUrl: null };
    const fetchFn = jest.fn().mockResolvedValue({ username: 'alice' });

    const result = await getCachedProfile('alice', fetchFn);

    expect(result).toEqual({ username: 'alice' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('invalidateProfileCache is a silent no-op when redisUrl is unset', async () => {
    store.config = { ...config, redisUrl: null };
    await expect(invalidateProfileCache('alice')).resolves.toBeUndefined();
  });
});

describeIfRedis('getCachedProfile — real Redis', () => {
  const testUsername = `cachetest-${Date.now()}`;

  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    // Clean up whatever key this suite's own username landed under —
    // avoids leaving test keys in the real cache indefinitely (TTL would
    // clear it eventually anyway, but no reason to wait).
    await invalidateProfileCache(testUsername);
    await closeProfileCacheConnection();
  });

  it('calls fetchFn on a miss, then serves the cached value on a hit without calling fetchFn again', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ username: testUsername, bio: 'first fetch' });

    const first = await getCachedProfile(testUsername, fetchFn);
    expect(first.bio).toBe('first fetch');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second call's fetchFn returns something different — if the cache is
    // actually being read, this new value must NOT be what comes back.
    const secondFetchFn = jest.fn().mockResolvedValue({ username: testUsername, bio: 'should not see this' });
    const second = await getCachedProfile(testUsername, secondFetchFn);

    expect(second.bio).toBe('first fetch');
    expect(secondFetchFn).not.toHaveBeenCalled();
  });

  it('invalidateProfileCache forces the next call to hit fetchFn again', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ username: testUsername, bio: 'before invalidate' });
    await getCachedProfile(testUsername, fetchFn);

    await invalidateProfileCache(testUsername);

    const freshFetchFn = jest.fn().mockResolvedValue({ username: testUsername, bio: 'after invalidate' });
    const result = await getCachedProfile(testUsername, freshFetchFn);

    expect(result.bio).toBe('after invalidate');
    expect(freshFetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not cache a null result (so a genuinely-missing user is re-checked, not permanently 404d)', async () => {
    const missingUsername = `nonexistent-${Date.now()}`;
    const fetchFn = jest.fn().mockResolvedValue(null);

    await getCachedProfile(missingUsername, fetchFn);
    await getCachedProfile(missingUsername, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
