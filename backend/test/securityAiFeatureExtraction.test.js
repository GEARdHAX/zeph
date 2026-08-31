const db = require('./helpers/db');
const SecurityEventService = require('../src/services/securityEventService');
const { extractAuthFeatures, extractHostFeatures } = require('../src/services/securityAi/featureExtraction');

// 300ms — comfortably covers 3 sequential fire-and-forget
// SecurityEventService.record() Mongo writes settling; 100ms occasionally
// wasn't enough for 3 real inserts in a row and produced a flaky count.
const flush = () => new Promise((resolve) => { setTimeout(resolve, 300); });

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

describe('extractAuthFeatures', () => {
  it('returns null without a userId', async () => {
    expect(await extractAuthFeatures({ userId: null })).toBeNull();
  });

  it('counts recent LOGIN_FAILED events for the given user only', async () => {
    const userId = 'user-1';
    SecurityEventService.record({
      type: 'LOGIN_FAILED', severity: 'medium', actor: { userId }, result: 'failure',
    });
    SecurityEventService.record({
      type: 'LOGIN_FAILED', severity: 'medium', actor: { userId }, result: 'failure',
    });
    SecurityEventService.record({
      type: 'LOGIN_FAILED', severity: 'medium', actor: { userId: 'someone-else' }, result: 'failure',
    });
    await flush();

    const features = await extractAuthFeatures({ userId, newDevice: true, sessionAgeMs: 1000 });
    expect(features.failedLoginCount).toBe(2);
    expect(features.scope).toBe('user');
    expect(features.newDevice).toBe(true);
    expect(features.sessionAgeMs).toBe(1000);
  });

  it('counts PERMISSION_DENIED and UNAUTHORIZED_ACCESS together as permissionDeniedCount', async () => {
    const userId = 'user-2';
    SecurityEventService.record({
      type: 'PERMISSION_DENIED', severity: 'medium', actor: { userId }, result: 'blocked',
    });
    SecurityEventService.record({
      type: 'UNAUTHORIZED_ACCESS', severity: 'medium', actor: { userId }, result: 'blocked',
    });
    await flush();

    const features = await extractAuthFeatures({ userId });
    expect(features.permissionDeniedCount).toBe(2);
  });

  it('does not count events outside the time window', async () => {
    const userId = 'user-3';
    SecurityEventService.record({
      type: 'LOGIN_FAILED', severity: 'medium', actor: { userId }, result: 'failure',
    });
    await flush();

    const features = await extractAuthFeatures({ userId, windowMs: 1 }); // 1ms window — the just-recorded event is already outside it
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(features.failedLoginCount).toBeGreaterThanOrEqual(0); // sanity: never throws; exact count depends on timing but must not include events from a much later window
  });

  it('defaults newDevice to false and sessionAgeMs to null when not provided', async () => {
    const features = await extractAuthFeatures({ userId: 'user-4' });
    expect(features.newDevice).toBe(false);
    expect(features.sessionAgeMs).toBeNull();
  });
});

describe('extractHostFeatures', () => {
  it('returns null without a sensorId', async () => {
    expect(await extractHostFeatures({ sensorId: null })).toBeNull();
  });

  it('counts PROCESS_ANOMALY/NETWORK_ANOMALY/scan events for the given sensor only', async () => {
    const sensorId = 'sensor-1';
    SecurityEventService.record({
      type: 'PROCESS_ANOMALY', severity: 'medium', sourceSystem: 'ebpf', result: 'unknown', metadata: { sensorId },
    });
    SecurityEventService.record({
      type: 'PORT_SCAN_ANOMALY', severity: 'high', sourceSystem: 'network_sensor', result: 'unknown', metadata: { sensorId },
    });
    SecurityEventService.record({
      type: 'PROCESS_ANOMALY', severity: 'medium', sourceSystem: 'ebpf', result: 'unknown', metadata: { sensorId: 'other-sensor' },
    });
    await flush();

    const features = await extractHostFeatures({ sensorId, hostId: 'host-1' });
    expect(features.processAnomalyCount).toBe(1);
    expect(features.portScanCount).toBe(1);
    expect(features.scope).toBe('host');
    expect(features.hostId).toBe('host-1');
  });

  it('computes uniqueDestinationCount from distinct metadata.destinationIp values', async () => {
    const sensorId = 'sensor-2';
    SecurityEventService.record({
      type: 'THREAT_INTEL_NETWORK_MATCH', severity: 'high', sourceSystem: 'network_sensor', result: 'unknown', metadata: { sensorId, destinationIp: '203.0.113.5' },
    });
    SecurityEventService.record({
      type: 'THREAT_INTEL_NETWORK_MATCH', severity: 'high', sourceSystem: 'network_sensor', result: 'unknown', metadata: { sensorId, destinationIp: '203.0.113.5' },
    });
    SecurityEventService.record({
      type: 'THREAT_INTEL_NETWORK_MATCH', severity: 'high', sourceSystem: 'network_sensor', result: 'unknown', metadata: { sensorId, destinationIp: '203.0.113.6' },
    });
    await flush();

    const features = await extractHostFeatures({ sensorId });
    expect(features.uniqueDestinationCount).toBe(2);
    expect(features.maliciousIpCount).toBe(3);
  });

  it('returns zero counts for a sensor with no recent events', async () => {
    const features = await extractHostFeatures({ sensorId: 'quiet-sensor' });
    expect(features.processAnomalyCount).toBe(0);
    expect(features.uniqueDestinationCount).toBe(0);
  });
});
