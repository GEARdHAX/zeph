const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const SecurityEvent = require('../src/models/SecurityEvent');
const SecurityEventService = require('../src/services/securityEventService');
const { shouldEnrich } = require('../src/services/threatIntel/securityEventEnrichment');
const { MOCK_MALICIOUS_IP, MOCK_CLEAN_IP, buildMockProvider } = require('../src/services/threatIntel/providers/mockProvider');

jest.mock('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const { getProvider } = require('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const threatIntelService = require('../src/services/threatIntel/threatIntelService');

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
  // eslint-disable-next-line global-require
  const { closeThreatIntelCacheConnection } = require('../src/services/threatIntel/cache');
  await closeThreatIntelCacheConnection();
});

beforeEach(() => {
  store.config = {
    ...config, redisUrl: null, abuseIpDbEnabled: true, abuseIpDbApiKey: 'test-key', abuseIpDbDailyBudget: 800, threatIntelCacheTtlSeconds: 21600,
  };
  threatIntelService.resetBreakerForTests();
});

afterEach(async () => {
  await db.clearDatabase();
  jest.restoreAllMocks();
});

const flush = () => new Promise((resolve) => { setTimeout(resolve, 150); });

describe('threatIntel/securityEventEnrichment — shouldEnrich (spec section 16)', () => {
  it.each(['LOGIN_SUCCESS', 'LOGIN_FAILED', 'RATE_LIMIT_TRIGGERED', 'UNAUTHORIZED_ACCESS', 'PERMISSION_DENIED', 'FILE_UPLOAD_REJECTED', 'NETWORK_CONNECTION', 'NETWORK_ANOMALY'])(
    'enriches %s',
    (type) => {
      expect(shouldEnrich(type)).toBe(true);
    },
  );

  it.each(['MESSAGE_SENT', 'GROUP_JOIN', 'LOGOUT', 'ADMIN_ACTION'])('does not enrich ordinary event %s', (type) => {
    expect(shouldEnrich(type)).toBe(false);
  });

  it('never re-enriches its own threat-intel events (avoids a circular enrichment loop)', () => {
    expect(shouldEnrich('THREAT_INTEL_MATCH')).toBe(false);
    expect(shouldEnrich('THREAT_INTEL_LOOKUP_FAILED')).toBe(false);
    expect(shouldEnrich('THREAT_INTEL_RATE_LIMITED')).toBe(false);
  });
});

describe('threatIntel/securityEventEnrichment — end to end via SecurityEventService.record()', () => {
  it('a LOGIN_FAILED event from a malicious IP gets enriched with threatIntelligence metadata', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const eventId = SecurityEventService.record({
      type: 'LOGIN_FAILED',
      severity: 'medium',
      source: { ip: MOCK_MALICIOUS_IP },
      result: 'failure',
    });

    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.metadata.threatIntelligence).toBeDefined();
    expect(saved.metadata.threatIntelligence.matched).toBe(true);
    expect(saved.metadata.threatIntelligence.confidence).toBe(94);
  });

  it('a LOGIN_FAILED event from a clean IP is still enriched, with matched:false (not left unenriched)', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const eventId = SecurityEventService.record({
      type: 'LOGIN_FAILED',
      severity: 'medium',
      source: { ip: MOCK_CLEAN_IP },
      result: 'failure',
    });

    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.metadata.threatIntelligence).toBeDefined();
    expect(saved.metadata.threatIntelligence.matched).toBe(false);
  });

  it('an event type not in the enrichment list is never touched', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const eventId = SecurityEventService.record({
      type: 'MESSAGE_SENT',
      severity: 'low',
      source: { ip: MOCK_MALICIOUS_IP },
      result: 'success',
    });

    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.metadata.threatIntelligence).toBeUndefined();
  });

  it('a Phase 4 NETWORK_ANOMALY event (no source.ip, IP lives in metadata.network.destinationIp) still gets enriched', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const eventId = SecurityEventService.record({
      type: 'NETWORK_ANOMALY',
      severity: 'medium',
      source: {},
      target: { resource: 'ebpf_sensor', action: 'network_anomaly' },
      result: 'unknown',
      sourceSystem: 'ebpf',
      metadata: { network: { destinationIp: MOCK_MALICIOUS_IP } },
    });

    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.metadata.threatIntelligence).toBeDefined();
    expect(saved.metadata.threatIntelligence.matched).toBe(true);
  });

  it('an event with no source IP is never enriched (nothing to look up)', async () => {
    getProvider.mockReturnValue(buildMockProvider());
    const eventId = SecurityEventService.record({
      type: 'LOGIN_FAILED',
      severity: 'medium',
      source: {},
      result: 'failure',
    });

    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.metadata.threatIntelligence).toBeUndefined();
  });

  it('enrichment failure never affects the original event\'s own persisted data', async () => {
    getProvider.mockReturnValue(buildMockProvider({ failOn: [MOCK_MALICIOUS_IP], failReason: 'server_error' }));
    const eventId = SecurityEventService.record({
      type: 'LOGIN_FAILED',
      severity: 'medium',
      source: { ip: MOCK_MALICIOUS_IP },
      result: 'failure',
      metadata: { reason: 'bad_password' },
    });

    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.type).toBe('LOGIN_FAILED');
    expect(saved.metadata.reason).toBe('bad_password'); // original metadata untouched
  });
});
