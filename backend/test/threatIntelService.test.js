const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const ThreatIndicator = require('../src/models/ThreatIndicator');
const SecurityEvent = require('../src/models/SecurityEvent');
const { closeThreatIntelCacheConnection } = require('../src/services/threatIntel/cache');
const { MOCK_MALICIOUS_IP, MOCK_CLEAN_IP, buildMockProvider } = require('../src/services/threatIntel/providers/mockProvider');

jest.mock('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const { getProvider, disabledProvider } = require('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const threatIntelService = require('../src/services/threatIntel/threatIntelService');

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
  await closeThreatIntelCacheConnection();
});

beforeEach(() => {
  store.config = {
    ...config, redisUrl: null, abuseIpDbEnabled: true, abuseIpDbApiKey: 'test-key', abuseIpDbDailyBudget: 800, threatIntelCacheTtlSeconds: 21600,
  };
  // Circuit breaker is module-level shared state (see circuitBreaker.js's
  // own header comment on why it's in-process) — reset it directly between
  // tests rather than reloading the whole module tree, so tests stay
  // order-independent without fighting Jest's module cache across a mocked
  // dependency.
  threatIntelService.resetBreakerForTests();
});

afterEach(async () => {
  await db.clearDatabase();
  jest.restoreAllMocks();
});

describe('threatIntelService.lookup — validation and normalization', () => {
  it('returns UNKNOWN for an unparseable indicator, without calling the provider', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const result = await threatIntelService.lookup('not a real indicator');
    expect(result.malicious).toBe(false);
    expect(result.metadata.reason).toBe('invalid_indicator');
  });

  it('returns UNKNOWN for a private IP without calling the provider (spec section 27)', async () => {
    const mock = buildMockProvider();
    getProvider.mockReturnValue(mock);
    const result = await threatIntelService.lookup('192.168.1.1');
    expect(result.metadata.reason).toBe('private_or_reserved_ip');
    expect(mock.callCount()).toBe(0);
  });

  it('returns UNKNOWN for a loopback address without calling the provider', async () => {
    const mock = buildMockProvider();
    getProvider.mockReturnValue(mock);
    const result = await threatIntelService.lookup('127.0.0.1');
    expect(result.metadata.reason).toBe('private_or_reserved_ip');
    expect(mock.callCount()).toBe(0);
  });
});

describe('threatIntelService.lookup — provider results', () => {
  it('a malicious IP is correctly identified and persisted', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const result = await threatIntelService.lookup(MOCK_MALICIOUS_IP);
    expect(result.malicious).toBe(true);
    expect(result.confidence).toBe(94);
    expect(result.severity).toBe('critical');

    const stored = await ThreatIndicator.findOne({ normalizedIndicator: MOCK_MALICIOUS_IP });
    expect(stored).not.toBeNull();
    expect(stored.status).toBe('MALICIOUS');
  });

  it('a clean IP is correctly identified and persisted as CLEAN, not skipped', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const result = await threatIntelService.lookup(MOCK_CLEAN_IP);
    expect(result.malicious).toBe(false);

    const stored = await ThreatIndicator.findOne({ normalizedIndicator: MOCK_CLEAN_IP });
    expect(stored).not.toBeNull();
    expect(stored.status).toBe('CLEAN'); // negative caching persisted too, not just in Redis
  });

  it('an UNKNOWN (non-IP type, no provider coverage) result for a domain', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const result = await threatIntelService.lookup('example.com');
    expect(result.malicious).toBe(false);
    expect(result.metadata.reason).toBe('no_provider_for_type');
  });

  it('a provider failure returns UNKNOWN, never CLEAN (spec section 15)', async () => {
    getProvider.mockReturnValue(buildMockProvider({ failOn: ['203.0.113.99'] }));
    const result = await threatIntelService.lookup('203.0.113.99');
    expect(result.malicious).toBe(false);
    expect(result.metadata.reason).toBe('server_error');
    // Critically: this is NOT the same as a confirmed-clean result — no
    // ThreatIndicator gets persisted as CLEAN from a failure.
    const stored = await ThreatIndicator.findOne({ normalizedIndicator: '203.0.113.99' });
    expect(stored).toBeNull();
  });

  it('records a THREAT_INTEL_MATCH SecurityEvent for a malicious result', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    await threatIntelService.lookup(MOCK_MALICIOUS_IP);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const event = await SecurityEvent.findOne({ type: 'THREAT_INTEL_MATCH' });
    expect(event).not.toBeNull();
    expect(event.metadata.confidence).toBe(94);
  });

  it('does NOT record a THREAT_INTEL_MATCH event for a clean result (no log spam per clean check)', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    await threatIntelService.lookup(MOCK_CLEAN_IP);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const event = await SecurityEvent.findOne({ type: 'THREAT_INTEL_MATCH' });
    expect(event).toBeNull();
  });
});

describe('threatIntelService.lookup — disabled provider', () => {
  it('returns UNKNOWN when the provider is disabled, without throwing', async () => {
    getProvider.mockReturnValue(disabledProvider);
    const result = await threatIntelService.lookup('203.0.113.55');
    expect(result.malicious).toBe(false);
    expect(result.metadata.reason).toBe('provider_disabled');
  });
});

describe('threatIntelService.lookup — priority (spec section 18)', () => {
  it('LOW priority never calls the provider on a cache miss', async () => {
    const mock = buildMockProvider();
    getProvider.mockReturnValue(mock);
    const result = await threatIntelService.lookup('203.0.113.77', { priority: 'LOW' });
    expect(mock.callCount()).toBe(0);
    expect(result.metadata.reason).toBe('low_priority_skip');
  });
});

describe('threatIntelService.lookup — circuit breaker integration', () => {
  it('after enough provider failures, the circuit opens and subsequent lookups skip the provider entirely', async () => {
    const failingIps = ['203.0.113.201', '203.0.113.202', '203.0.113.203', '203.0.113.204', '203.0.113.205'];
    const mock = buildMockProvider({ failOn: failingIps });
    getProvider.mockReturnValue(mock);

    // Default failureThreshold is 5 (circuitBreaker.js) — 5 distinct
    // failing indicators (never cached, since failures aren't reused
    // across different keys) to trip it without relying on cache/lock
    // interactions across the same key.
    // eslint-disable-next-line no-restricted-syntax
    for (const ip of failingIps) {
      // eslint-disable-next-line no-await-in-loop
      await threatIntelService.lookup(ip);
    }

    expect(threatIntelService.breaker.getState()).toBe('OPEN');

    const callsBeforeSkip = mock.callCount();
    const result = await threatIntelService.lookup('203.0.113.206'); // a brand new, never-before-seen indicator
    expect(mock.callCount()).toBe(callsBeforeSkip); // no new call attempted — circuit was open
    expect(result.metadata.reason).toBe('circuit_open');
  });
});

describe('threatIntelService.lookup — quota (Redis unavailable = fail-open on the tracking mechanism, per quota.js\'s own documented contract)', () => {
  it('a lookup still succeeds when Redis (and therefore quota tracking) is unavailable', async () => {
    const mock = buildMockProvider();
    getProvider.mockReturnValue(mock);
    const result = await threatIntelService.lookup('203.0.113.210');
    expect(mock.callCount()).toBe(1);
    expect(result.malicious).toBe(false);
  });
});
