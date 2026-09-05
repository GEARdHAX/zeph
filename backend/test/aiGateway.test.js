// Zeph AI — gateway quota-accounting regression test (Phase 13). Verifies
// the bug fix: a failed/invalid provider call must NEVER consume the user's
// minute/day quota, only a genuinely successful one should. Mocks
// ai/quota.js and ai/provider.js directly so this is a pure unit test of
// runGoverned's control flow, not an integration test needing real Redis.
jest.mock('../src/ai/quota');
jest.mock('../src/ai/provider');

const store = require('../src/store');
const config = require('../config');
const quota = require('../src/ai/quota');
const { getProvider } = require('../src/ai/provider');
const { runGoverned } = require('../src/ai/gateway');

beforeEach(() => {
  store.config = { ...config, aiProvider: 'groq', groqApiKey: 'test-key' };
  quota.checkQuota.mockResolvedValue({ allowed: true });
  quota.recordUsage.mockResolvedValue(undefined);
  quota.acquireConcurrency.mockResolvedValue(undefined);
  quota.releaseConcurrency.mockResolvedValue(undefined);
});

afterEach(() => jest.clearAllMocks());

describe('runGoverned — quota accounting (Phase 13 fix)', () => {
  it('records usage on a successful call', async () => {
    getProvider.mockReturnValue({ enabled: true, generate: async () => 'a fine response' });

    const result = await runGoverned({
      userId: 'u1', ip: '1.1.1.1', prompt: 'hi', metricsFeature: 'translation',
    });

    expect(result.ok).toBe(true);
    expect(quota.recordUsage).toHaveBeenCalledTimes(1);
    expect(quota.recordUsage).toHaveBeenCalledWith({ userId: 'u1', ip: '1.1.1.1' });
  });

  it('does NOT record usage when the provider call fails (timeout/5xx)', async () => {
    getProvider.mockReturnValue({
      enabled: true,
      generate: async () => { throw new Error('Groq request failed: 500 Internal Server Error'); },
    });

    const result = await runGoverned({
      userId: 'u1', ip: '1.1.1.1', prompt: 'hi', metricsFeature: 'translation',
    });

    expect(result.ok).toBe(false);
    expect(quota.recordUsage).not.toHaveBeenCalled();
  });

  it('does NOT record usage when the provider returns invalid/empty output', async () => {
    getProvider.mockReturnValue({ enabled: true, generate: async () => '   ' });

    const result = await runGoverned({
      userId: 'u1', ip: '1.1.1.1', prompt: 'hi', metricsFeature: 'translation',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('INVALID_OUTPUT');
    expect(quota.recordUsage).not.toHaveBeenCalled();
  });

  it('does NOT record usage when quota was already exceeded (never reaches the provider)', async () => {
    quota.checkQuota.mockResolvedValue({ allowed: false, reason: 'RATE_LIMITED', detail: 'user_per_minute' });
    getProvider.mockReturnValue({ enabled: true, generate: async () => 'should not be called' });

    const result = await runGoverned({
      userId: 'u1', ip: '1.1.1.1', prompt: 'hi', metricsFeature: 'translation',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('RATE_LIMITED');
    expect(quota.recordUsage).not.toHaveBeenCalled();
  });

  it('always releases concurrency, even when the provider throws', async () => {
    getProvider.mockReturnValue({ enabled: true, generate: async () => { throw new Error('boom'); } });

    await runGoverned({
      userId: 'u1', ip: '1.1.1.1', prompt: 'hi', metricsFeature: 'translation',
    });

    expect(quota.acquireConcurrency).toHaveBeenCalledWith('u1');
    expect(quota.releaseConcurrency).toHaveBeenCalledWith('u1');
  });

  it('returns a requestId on every outcome, generating one when the caller supplies none', async () => {
    getProvider.mockReturnValue({ enabled: true, generate: async () => 'ok' });
    const result = await runGoverned({
      userId: 'u1', ip: '1.1.1.1', prompt: 'hi', metricsFeature: 'translation',
    });
    expect(typeof result.requestId).toBe('string');
    expect(result.requestId.length).toBeGreaterThan(0);
  });

  it('propagates a caller-supplied requestId unchanged (for cross-stage correlation)', async () => {
    getProvider.mockReturnValue({ enabled: true, generate: async () => 'ok' });
    const result = await runGoverned({
      userId: 'u1', ip: '1.1.1.1', prompt: 'hi', metricsFeature: 'translation', requestId: 'caller-supplied-id',
    });
    expect(result.requestId).toBe('caller-supplied-id');
  });
});
