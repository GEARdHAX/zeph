require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const { computeRiskFactors } = require('../src/services/zeroTrust/riskEngine');
const { MOCK_MALICIOUS_IP, MOCK_CLEAN_IP, buildMockProvider } = require('../src/services/threatIntel/providers/mockProvider');

jest.mock('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const { getProvider } = require('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const threatIntelService = require('../src/services/threatIntel/threatIntelService');
// eslint-disable-next-line import/order
const { closeThreatIntelCacheConnection } = require('../src/services/threatIntel/cache');
// eslint-disable-next-line import/order
const { closeSecurityAiCacheConnection } = require('../src/services/securityAi/cache'); // Phase 6 — riskEngine.js's computeRiskFactors() now also opens this connection whenever userId is set (its own short-TTL AI-signal cache read); must be closed here too or this suite leaves an open Redis handle past the test run

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
  await closeThreatIntelCacheConnection();
  await closeSecurityAiCacheConnection();
});

beforeEach(() => {
  threatIntelService.resetBreakerForTests();
});

afterEach(async () => {
  await db.clearDatabase();
  jest.restoreAllMocks();
});

describe('riskEngine + threatIntel integration — no Redis (the test-suite default; matches every other Phase 2/3 test\'s baseline)', () => {
  beforeEach(() => {
    store.config = {
      ...config, redisUrl: null, abuseIpDbEnabled: true, abuseIpDbApiKey: 'test-key', abuseIpDbDailyBudget: 800, threatIntelCacheTtlSeconds: 21600,
    };
  });

  it('a MALICIOUS IP the risk engine has never seen cached contributes NO signal (LOW priority never spends quota to find out, and with no Redis there is no cache to hit anyway) — documents the real, deliberate limitation', async () => {
    const mock = buildMockProvider();
    getProvider.mockReturnValue(mock);
    const knownSession = { createdAt: new Date(Date.now() - 999999), revokedAt: null };

    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession, ip: MOCK_MALICIOUS_IP });

    expect(result.factors.some((f) => f.type === 'MALICIOUS_IP')).toBe(false);
    expect(mock.callCount()).toBe(0); // never actually asked the provider
  });

  it('a clean IP contributes no risk factor at all', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const knownSession = { createdAt: new Date(Date.now() - 999999), revokedAt: null };

    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession, ip: MOCK_CLEAN_IP });

    expect(result.factors.some((f) => f.type === 'MALICIOUS_IP')).toBe(false);
  });

  it('an uncached IP (the LOW-priority lookup never reaches the provider at all) contributes no signal and never throws', async () => {
    const mock = buildMockProvider({ failOn: ['203.0.113.220'] }); // failOn is irrelevant here — LOW priority means the provider is never actually called, so even a configured failure never triggers
    getProvider.mockReturnValue(mock);
    const knownSession = { createdAt: new Date(Date.now() - 999999), revokedAt: null };
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession, ip: '203.0.113.220' });
    expect(result.factors.some((f) => f.type === 'MALICIOUS_IP')).toBe(false);
    expect(result.score).toBe(0); // KNOWN_DEVICE's -10 clamped to the [0,100] floor
    expect(mock.callCount()).toBe(0);
  });

  it('the risk-engine lookup uses LOW priority and never spends provider budget on a cache miss', async () => {
    const mock = buildMockProvider();
    getProvider.mockReturnValue(mock);
    await computeRiskFactors({ userId: 'user-1', session: null, ip: '203.0.113.221' });
    // LOW priority (riskEngine.js's own hardcoded choice) skips the
    // provider entirely on a miss — the mock is never actually called.
    expect(mock.callCount()).toBe(0);
  });

  it('no ip provided -> no threat-intel lookup attempted at all', async () => {
    const mock = buildMockProvider();
    getProvider.mockReturnValue(mock);
    await computeRiskFactors({ userId: 'user-1', session: null });
    expect(mock.callCount()).toBe(0);
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('riskEngine + threatIntel integration — real Redis (Phase 3 spec section 24: the actual cache-hit path)', () => {
  beforeEach(() => {
    store.config = {
      ...config, redisUrl: process.env.REDIS_URL, abuseIpDbEnabled: true, abuseIpDbApiKey: 'test-key', abuseIpDbDailyBudget: 800, threatIntelCacheTtlSeconds: 21600,
    };
  });

  it('once an IP is already cached as malicious (e.g. by securityEventEnrichment.js\'s HIGH-priority lookup), the risk engine\'s own LOW-priority read picks it up as MALICIOUS_IP', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    // Pre-warm the cache at a real priority, matching how
    // securityEventEnrichment.js's LOGIN_FAILED trigger would actually
    // populate it before any risk evaluation runs for the same IP.
    await threatIntelService.lookup(MOCK_MALICIOUS_IP, { type: 'IP', priority: 'HIGH' });

    const knownSession = { createdAt: new Date(Date.now() - 999999), revokedAt: null };
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession, ip: MOCK_MALICIOUS_IP });

    const factor = result.factors.find((f) => f.type === 'MALICIOUS_IP');
    expect(factor).toBeDefined();
    expect(factor.confidence).toBe(94);
    expect(result.score).toBe(30); // KNOWN_DEVICE(-10) + MALICIOUS_IP(+40)
  });

  it('threat intelligence ALONE (even with a real cache-hit malicious verdict) never pushes a SENSITIVE-category request past its own threshold without other factors — evidence, not authority (Phase 3 spec section 2)', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    await threatIntelService.lookup(MOCK_MALICIOUS_IP, { type: 'IP', priority: 'HIGH' }); // real cache hit this time, not the no-Redis no-op

    // A KNOWN device (-10) from a genuinely-cached malicious IP (+40) = 30,
    // still LOW — nowhere near the SENSITIVE policy's allowBelow:50
    // STEP_UP threshold (see policies.js) on its own.
    const knownSession = { createdAt: new Date(Date.now() - 999999), revokedAt: null };
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession, ip: MOCK_MALICIOUS_IP });
    expect(result.score).toBeLessThan(50);
    expect(result.level).toBe('LOW');
  });
});
