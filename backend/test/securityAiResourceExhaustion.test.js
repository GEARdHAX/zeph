// Resource-exhaustion / flood test (spec section 57) — simulates a burst of
// security events and verifies the correlation layer aggregates them into a
// bounded number of incidents rather than 1:1 incident-per-event, which is
// the actual mechanism (spec section 33/38) that keeps a flood of raw
// telemetry from becoming a flood of AI jobs.
const db = require('./helpers/db');
const SecurityIncident = require('../src/models/SecurityIncident');
const { correlateEvent, CORRELATION_WINDOW_MS } = require('../src/services/securityAi/correlation');
const { classifyIncidentPriority } = require('../src/services/securityAi/priority');

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const bucketSafeBase = () => new Date(Math.floor(Date.now() / CORRELATION_WINDOW_MS) * CORRELATION_WINDOW_MS + 2 * 60 * 1000);

describe('resource exhaustion — 10,000 events from one sensor collapse into one incident', () => {
  it('10,000 correlatable events, same sensor, same time bucket -> exactly ONE incident, not 10,000', async () => {
    const t = bucketSafeBase();
    const N = 10000;

    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < N; i++) {
      // eslint-disable-next-line no-await-in-loop
      await correlateEvent({
        type: 'PROCESS_ANOMALY',
        severity: 'medium',
        sourceSystem: 'ebpf',
        timestamp: new Date(t.getTime() + (i % 1000)), // spread within the same bucket
        metadata: { sensorId: 'flood-sensor', hostId: 'flood-host' },
      });
    }

    const count = await SecurityIncident.countDocuments();
    expect(count).toBe(1);

    const incident = await SecurityIncident.findOne();
    expect(incident.eventCount).toBe(N);
  }, 60000);
});

describe('resource exhaustion — 10,000 flows across MANY distinct sensors bound to many (not unbounded) incidents', () => {
  it('10,000 events across 100 distinct sensors produce AT MOST 100 incidents, not 10,000', async () => {
    const t = bucketSafeBase();
    const N = 10000;
    const SENSOR_COUNT = 100;

    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < N; i++) {
      // eslint-disable-next-line no-await-in-loop
      await correlateEvent({
        type: 'NETWORK_ANOMALY',
        severity: 'low',
        sourceSystem: 'network_sensor',
        timestamp: t,
        metadata: { sensorId: `flood-sensor-${i % SENSOR_COUNT}`, hostId: `flood-host-${i % SENSOR_COUNT}` },
      });
    }

    const count = await SecurityIncident.countDocuments();
    expect(count).toBeLessThanOrEqual(SENSOR_COUNT);
  }, 60000);
});

describe('resource exhaustion — priority classification bounds which incidents even reach the AI queue', () => {
  it('a single low-severity signal never classifies as AI-worthy, regardless of how many times the same signal repeats', () => {
    // A single-signal incident (e.g. many NETWORK_ANOMALY "unusual
    // destination" events, all folding into ONE incident with only that
    // one signal) never becomes AI-worthy — priority.js requires either
    // multiple distinct signal categories or a specific high-value single
    // signal (malicious_ip/process_anomaly/scan). This is what stops a
    // flood of an otherwise-benign repeated signal from spamming the AI
    // queue even after correlation has already bounded it to one incident.
    const incident = { signals: ['unusual_destination'], eventCount: 50000 };
    expect(classifyIncidentPriority(incident)).toBeNull();
  });

  it('a genuinely multi-signal incident IS classified as AI-worthy exactly once, regardless of eventCount', () => {
    const incident = { signals: ['process_anomaly', 'malicious_ip', 'port_scan'], eventCount: 50000 };
    expect(classifyIncidentPriority(incident)).toBe('CRITICAL');
  });
});
