require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const SecurityEvent = require('../src/models/SecurityEvent');
const { evaluateFlow, evaluateDnsQuery } = require('../src/services/networkIntel/networkRules');
const { MOCK_MALICIOUS_IP, MOCK_CLEAN_IP, buildMockProvider } = require('../src/services/threatIntel/providers/mockProvider');

jest.mock('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const { getProvider } = require('../src/services/threatIntel/provider');
// eslint-disable-next-line import/order
const threatIntelService = require('../src/services/threatIntel/threatIntelService');
// eslint-disable-next-line import/order
const { closeThreatIntelCacheConnection } = require('../src/services/threatIntel/cache');
// eslint-disable-next-line import/order
const { closeNetworkIntelConnection } = require('../src/services/networkIntel/cache');

const flush = () => new Promise((resolve) => { setTimeout(resolve, 150); });

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
  await closeThreatIntelCacheConnection();
  await closeNetworkIntelConnection();
});

beforeEach(() => {
  getProvider.mockReturnValue(buildMockProvider());
  threatIntelService.resetBreakerForTests();
  store.config = {
    ...config,
    redisUrl: null, // no Redis in this suite — window counters stay all-zero, so scan/beacon/exfil rules never fire; this suite is about the threat-intel wiring and config gating, not the Redis-dependent counters (see networkIntelWindowCounters.test.js for those, gated on REDIS_URL)
    abuseIpDbEnabled: true,
    abuseIpDbApiKey: 'test-key',
    abuseIpDbDailyBudget: 800,
    threatIntelCacheTtlSeconds: 21600,
    networkSensorEnabled: true,
    networkDnsAnalysisEnabled: true,
    networkBaselineEnabled: true,
    networkBaselineTrusted: '',
    networkFlowWindowMs: 60000,
    networkScanThreshold: 15,
    networkBeaconThreshold: 5,
    networkExfilThresholdBytes: 50 * 1024 * 1024,
  };
});

afterEach(async () => {
  await db.clearDatabase();
  jest.restoreAllMocks();
});

describe('networkRules.evaluateFlow — threat intelligence integration (spec section 12/44)', () => {
  // No Redis in this suite -> window counters (distinctPorts/distinctHosts/
  // cumulativeBytes) stay all-zero unconditionally (windowCounters.js's own
  // fail-safe — see networkIntelWindowCounters.test.js), so NO rule can
  // ever fire here and evaluateFlow's own threat-intel lookup always runs
  // at LOW priority. Per Phase 3's own contract (threatIntelService.js:
  // "LOW priority never spends provider quota on its own"), a LOW-priority
  // lookup on a cache miss returns UNKNOWN WITHOUT calling the provider —
  // so even a flow to a KNOWN-malicious mock IP produces no match here.
  // This is correct, not a gap: an ordinary one-off flow to an as-yet-
  // unknown IP should not itself burn AbuseIPDB quota. The HIGH-priority
  // escalation path (a rule firing -> a real check -> a real match) needs
  // real Redis counters to exercise honestly — see the describeIfRedis
  // block below.
  it('an ordinary flow to a malicious IP does NOT spend provider quota on its own (LOW priority, no Redis to escalate it)', async () => {
    await evaluateFlow({
      sensorId: 'sensor-1', hostId: 'host-1', flow: { destinationIp: MOCK_MALICIOUS_IP, destinationPort: 443, protocol: 'TCP', pid: 100 },
    });
    await flush();

    const match = await SecurityEvent.findOne({ type: 'THREAT_INTEL_NETWORK_MATCH' });
    expect(match).toBeNull();
  });

  it('a flow to a clean IP produces no THREAT_INTEL_NETWORK_MATCH', async () => {
    await evaluateFlow({
      sensorId: 'sensor-1', hostId: 'host-1', flow: { destinationIp: MOCK_CLEAN_IP, destinationPort: 443, protocol: 'TCP', pid: 100 },
    });
    await flush();

    const match = await SecurityEvent.findOne({ type: 'THREAT_INTEL_NETWORK_MATCH' });
    expect(match).toBeNull();
  });

  it('a flow to a private IP produces no THREAT_INTEL_NETWORK_MATCH (never sent to the provider — spec section 38)', async () => {
    await evaluateFlow({
      sensorId: 'sensor-1', hostId: 'host-1', flow: { destinationIp: '10.0.0.5', destinationPort: 443, protocol: 'TCP', pid: 100 },
    });
    await flush();

    const match = await SecurityEvent.findOne({ type: 'THREAT_INTEL_NETWORK_MATCH' });
    expect(match).toBeNull();
  });

  it('does nothing when NETWORK_SENSOR_ENABLED is false', async () => {
    store.config.networkSensorEnabled = false;
    await evaluateFlow({
      sensorId: 'sensor-1', hostId: 'host-1', flow: { destinationIp: MOCK_MALICIOUS_IP, destinationPort: 443, protocol: 'TCP', pid: 100 },
    });
    await flush();

    const match = await SecurityEvent.findOne({ type: 'THREAT_INTEL_NETWORK_MATCH' });
    expect(match).toBeNull();
  });

  it('does nothing when the flow has no process (pid) attribution', async () => {
    await evaluateFlow({
      sensorId: 'sensor-1', hostId: 'host-1', flow: { destinationIp: MOCK_MALICIOUS_IP, destinationPort: 443, protocol: 'TCP' },
    });
    await flush();

    const match = await SecurityEvent.findOne({ type: 'THREAT_INTEL_NETWORK_MATCH' });
    expect(match).toBeNull();
  });

  it('a trusted destination does not trip the unusual-destination rule', async () => {
    store.config.networkBaselineTrusted = `${MOCK_CLEAN_IP}`;
    await evaluateFlow({
      sensorId: 'sensor-1', hostId: 'host-1', flow: { destinationIp: MOCK_CLEAN_IP, destinationPort: 443, protocol: 'TCP', pid: 100 },
    });
    await flush();

    const unusual = await SecurityEvent.findOne({ type: 'NETWORK_ANOMALY', 'metadata.reason': 'unusual_destination' });
    expect(unusual).toBeNull();
  });

  it('an untrusted destination DOES trip the unusual-destination rule on first sighting', async () => {
    await evaluateFlow({
      sensorId: 'sensor-1', hostId: 'host-1', flow: { destinationIp: MOCK_CLEAN_IP, destinationPort: 443, protocol: 'TCP', pid: 100 },
    });
    await flush();

    const unusual = await SecurityEvent.findOne({ type: 'NETWORK_ANOMALY', 'metadata.reason': 'unusual_destination' });
    expect(unusual).toBeTruthy();
  });
});

describe('networkRules.evaluateDnsQuery — threat intelligence integration', () => {
  it('routes the domain through ThreatIntelService (never calls AbuseIPDB directly) and honestly finds no match today (IP-only provider)', async () => {
    const lookupSpy = jest.spyOn(threatIntelService, 'lookup');
    await evaluateDnsQuery({
      sensorId: 'sensor-1', hostId: 'host-1', dns: { domain: 'example.com', pid: 100, processName: 'node' },
    });
    await flush();

    expect(lookupSpy).toHaveBeenCalledWith('example.com', expect.objectContaining({ type: 'DOMAIN' }));
    const match = await SecurityEvent.findOne({ type: 'THREAT_INTEL_NETWORK_MATCH', 'metadata.domain': 'example.com' });
    expect(match).toBeNull(); // AbuseIPDB is IP-only — a DOMAIN lookup always returns UNKNOWN today, see networkRules.js's own comment
  });

  it('does nothing when NETWORK_DNS_ANALYSIS_ENABLED is false', async () => {
    store.config.networkDnsAnalysisEnabled = false;
    const lookupSpy = jest.spyOn(threatIntelService, 'lookup');
    await evaluateDnsQuery({
      sensorId: 'sensor-1', hostId: 'host-1', dns: { domain: 'example.com', pid: 100 },
    });
    expect(lookupSpy).not.toHaveBeenCalled();
  });
});

// Real Redis — same describeIfRedis gate every other Phase 3/4/5 Redis-
// dependent suite uses (groupCleanup.test.js's own convention). Exercises
// what the no-Redis suite above cannot: rule-driven counters actually
// accumulating, and a rule's own firing escalating that SAME flow's
// threat-intel lookup from LOW to HIGH priority (spec section 44's worked
// example, end to end).
const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('networkRules.evaluateFlow — rule-driven detection (real Redis)', () => {
  beforeEach(() => {
    store.config.redisUrl = process.env.REDIS_URL;
  });

  it('a port scan (many distinct ports, one process) produces PORT_SCAN_ANOMALY', async () => {
    const sensorId = `sensor-scan-${Date.now()}`;
    store.config.networkScanThreshold = 5;
    // eslint-disable-next-line no-plusplus
    for (let port = 1; port <= 6; port++) {
      // eslint-disable-next-line no-await-in-loop
      await evaluateFlow({
        sensorId, hostId: 'host-1', flow: {
          destinationIp: MOCK_CLEAN_IP, destinationPort: port, protocol: 'TCP', pid: 1000,
        },
      });
    }
    await flush();

    const scan = await SecurityEvent.findOne({ type: 'PORT_SCAN_ANOMALY', 'metadata.sensorId': sensorId });
    expect(scan).toBeTruthy();
    expect(scan.severity).toBe('high');
  });

  it('a host scan (many distinct destination IPs, one process) produces HOST_SCAN_ANOMALY', async () => {
    const sensorId = `sensor-hscan-${Date.now()}`;
    store.config.networkScanThreshold = 5;
    // eslint-disable-next-line no-plusplus
    for (let i = 1; i <= 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await evaluateFlow({
        sensorId, hostId: 'host-1', flow: {
          destinationIp: `198.51.100.${i}`, destinationPort: 443, protocol: 'TCP', pid: 2000,
        },
      });
    }
    await flush();

    const scan = await SecurityEvent.findOne({ type: 'HOST_SCAN_ANOMALY', 'metadata.sensorId': sensorId });
    expect(scan).toBeTruthy();
  });

  it('regular-interval repeated connections to the same destination produce POSSIBLE_BEACONING', async () => {
    const sensorId = `sensor-beacon-${Date.now()}`;
    store.config.networkBeaconThreshold = 3;
    const baseTime = Date.now();
    const originalNow = Date.now;
    try {
      // eslint-disable-next-line no-plusplus
      for (let i = 0; i < 4; i++) {
        Date.now = () => baseTime + i * 2000; // 2s apart — clears MIN_MEAN_GAP_MS, well within CoV tolerance
        // eslint-disable-next-line no-await-in-loop
        await evaluateFlow({
          sensorId, hostId: 'host-1', flow: {
            destinationIp: MOCK_CLEAN_IP, destinationPort: 443, protocol: 'TCP', pid: 3000,
          },
        });
      }
    } finally {
      Date.now = originalNow;
    }
    await flush();

    const beacon = await SecurityEvent.findOne({ type: 'POSSIBLE_BEACONING', 'metadata.sensorId': sensorId });
    expect(beacon).toBeTruthy();
    expect(beacon.metadata.destinationIp).toBe(MOCK_CLEAN_IP);
  });

  it('a large outbound transfer to a non-baseline destination produces POSSIBLE_DATA_EXFILTRATION', async () => {
    const sensorId = `sensor-exfil-${Date.now()}`;
    store.config.networkExfilThresholdBytes = 1000;
    await evaluateFlow({
      sensorId, hostId: 'host-1', flow: {
        destinationIp: MOCK_CLEAN_IP, destinationPort: 443, protocol: 'TCP', pid: 4000, bytesSent: 1500,
      },
    });
    await flush();

    const exfil = await SecurityEvent.findOne({ type: 'POSSIBLE_DATA_EXFILTRATION', 'metadata.sensorId': sensorId });
    expect(exfil).toBeTruthy();
  });

  it('a trusted destination never produces POSSIBLE_DATA_EXFILTRATION regardless of volume', async () => {
    const sensorId = `sensor-exfil-trusted-${Date.now()}`;
    store.config.networkExfilThresholdBytes = 1000;
    store.config.networkBaselineTrusted = MOCK_CLEAN_IP;
    await evaluateFlow({
      sensorId, hostId: 'host-1', flow: {
        destinationIp: MOCK_CLEAN_IP, destinationPort: 443, protocol: 'TCP', pid: 4001, bytesSent: 5000,
      },
    });
    await flush();

    const exfil = await SecurityEvent.findOne({ type: 'POSSIBLE_DATA_EXFILTRATION', 'metadata.sensorId': sensorId });
    expect(exfil).toBeNull();
  });

  it('a flow that trips the exfiltration rule to a MALICIOUS IP escalates its own threat-intel lookup to HIGH and produces a real THREAT_INTEL_NETWORK_MATCH', async () => {
    const sensorId = `sensor-escalate-${Date.now()}`;
    store.config.networkExfilThresholdBytes = 1000;
    await evaluateFlow({
      sensorId, hostId: 'host-1', flow: {
        destinationIp: MOCK_MALICIOUS_IP, destinationPort: 443, protocol: 'TCP', pid: 5000, bytesSent: 2000,
      },
    });
    await flush();

    const match = await SecurityEvent.findOne({ type: 'THREAT_INTEL_NETWORK_MATCH', 'metadata.sensorId': sensorId });
    expect(match).toBeTruthy();
    expect(match.sourceSystem).toBe('network_sensor');
  });
});
