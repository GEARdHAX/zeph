const store = require('../src/store');
const config = require('../config');
const { acquireLock, releaseLock } = require('../src/ai/dedup');

beforeAll(() => { store.config = { ...config, redisUrl: null }; });

describe('acquireLock — no Redis configured', () => {
  it('grants the lock uncoordinated (degrade, not block)', async () => {
    const result = await acquireLock('summary:room1:100');
    expect(result.acquired).toBe(true);
    expect(result.token).toBeNull();
  });
});

describe('releaseLock — no Redis configured', () => {
  it('resolves without throwing when there is no token to release', async () => {
    await expect(releaseLock('summary:room1:100', null)).resolves.toBeUndefined();
  });
});
