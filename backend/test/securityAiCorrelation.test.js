const db = require('./helpers/db');
const SecurityIncident = require('../src/models/SecurityIncident');
const { correlateEvent, correlationKeyFor, contextForIncident, CORRELATION_WINDOW_MS } = require('../src/services/securityAi/correlation');

// correlation.js buckets on fixed epoch-aligned windows (a documented,
// accepted tradeoff — see its own comment) — a test using bare `new
// Date()` as a base and adding a small offset can flakily straddle a real
// bucket boundary depending on wall-clock time when the suite happens to
// run. bucketSafeBase() returns a timestamp a safe distance (2 minutes)
// after its own bucket start, so any offset under ~10 minutes added to it
// is guaranteed to stay in the SAME bucket regardless of when the test runs.
const bucketSafeBase = () => new Date(Math.floor(Date.now() / CORRELATION_WINDOW_MS) * CORRELATION_WINDOW_MS + 2 * 60 * 1000);

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const makeEvent = (overrides = {}) => ({
  type: 'PROCESS_ANOMALY',
  severity: 'medium',
  sourceSystem: 'ebpf',
  timestamp: new Date(),
  metadata: { sensorId: 'sensor-1', hostId: 'host-1' },
  ...overrides,
});

describe('correlationKeyFor', () => {
  it('is stable for the same sensor+time-bucket', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-01-01T00:05:00Z'); // within the same 15m bucket
    expect(correlationKeyFor('sensor-1', t)).toBe(correlationKeyFor('sensor-1', t2));
  });

  it('differs across time buckets', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-01-01T00:20:00Z'); // a different 15m bucket
    expect(correlationKeyFor('sensor-1', t)).not.toBe(correlationKeyFor('sensor-1', t2));
  });

  it('differs across sensors for the same timestamp', () => {
    const t = new Date();
    expect(correlationKeyFor('sensor-1', t)).not.toBe(correlationKeyFor('sensor-2', t));
  });
});

describe('correlateEvent', () => {
  it('returns null for a non-correlatable event type', async () => {
    const result = await correlateEvent(makeEvent({ type: 'MESSAGE_SENT' }));
    expect(result).toBeNull();
  });

  it('returns null for an event with no sensorId', async () => {
    const result = await correlateEvent(makeEvent({ metadata: {} }));
    expect(result).toBeNull();
  });

  it('creates a new incident for the first correlatable event in a bucket', async () => {
    const incident = await correlateEvent(makeEvent());
    expect(incident.eventCount).toBe(1);
    expect(incident.signals).toEqual(['process_anomaly']);
    expect(incident.sensorIds).toEqual(['sensor-1']);
  });

  it('merges a second related event into the SAME incident, not a new one', async () => {
    const t = bucketSafeBase();
    await correlateEvent(makeEvent({ timestamp: t }));
    const second = await correlateEvent(makeEvent({
      type: 'THREAT_INTEL_NETWORK_MATCH', severity: 'high', sourceSystem: 'network_sensor', timestamp: new Date(t.getTime() + 60000),
    }));

    const count = await SecurityIncident.countDocuments();
    expect(count).toBe(1);
    expect(second.eventCount).toBe(2);
    expect(second.signals).toEqual(expect.arrayContaining(['process_anomaly', 'malicious_ip']));
    expect(second.sources).toEqual(expect.arrayContaining(['ebpf', 'network_sensor']));
  });

  it('escalates incident severity to the highest seen, never downgrades', async () => {
    const t = bucketSafeBase();
    await correlateEvent(makeEvent({ severity: 'low', timestamp: t }));
    const second = await correlateEvent(makeEvent({ severity: 'critical', timestamp: new Date(t.getTime() + 1000) }));
    expect(second.severity).toBe('critical');

    const third = await correlateEvent(makeEvent({ severity: 'low', timestamp: new Date(t.getTime() + 2000) }));
    expect(third.severity).toBe('critical'); // does not downgrade back to low
  });

  it('does not merge events from a different sensor into the same incident', async () => {
    const t = new Date();
    await correlateEvent(makeEvent({ timestamp: t, metadata: { sensorId: 'sensor-a', hostId: 'host-a' } }));
    await correlateEvent(makeEvent({ timestamp: t, metadata: { sensorId: 'sensor-b', hostId: 'host-b' } }));
    const count = await SecurityIncident.countDocuments();
    expect(count).toBe(2);
  });

  it('does not merge events far apart in time into the same incident', async () => {
    const t = new Date();
    await correlateEvent(makeEvent({ timestamp: t }));
    await correlateEvent(makeEvent({ timestamp: new Date(t.getTime() + 60 * 60 * 1000) })); // 1h later
    const count = await SecurityIncident.countDocuments();
    expect(count).toBe(2);
  });

  it('is idempotent for the bounded correlation-key shape (calling twice for the same bucket never creates duplicate incidents)', async () => {
    const t = new Date();
    await correlateEvent(makeEvent({ timestamp: t }));
    await correlateEvent(makeEvent({ timestamp: t }));
    await correlateEvent(makeEvent({ timestamp: t }));
    const count = await SecurityIncident.countDocuments();
    expect(count).toBe(1);
  });
});

describe('contextForIncident', () => {
  it('builds a bounded feature-vector-shaped context from an incident, never raw event data', () => {
    const context = contextForIncident({
      signals: ['process_anomaly', 'malicious_ip', 'port_scan'], hosts: ['host-1', 'host-2'],
    });
    expect(context.processAnomalyCount).toBe(1);
    expect(context.maliciousIpCount).toBe(1);
    expect(context.portScanCount).toBe(1);
    expect(context.networkAnomalyCount).toBe(0);
    expect(context.uniqueDestinationCount).toBe(2);
    expect(context.scope).toBe('host');
  });
});
