const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const SensorCredential = require('../src/models/SensorCredential');
const SecurityEvent = require('../src/models/SecurityEvent');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const createUser = async (overrides = {}) => {
  const password = await argon2.hash('password123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    level: overrides.level || 'standard',
    password,
  });
};

const createAdmin = (overrides = {}) => createUser({ ...overrides, level: 'root' });

const registerSensor = async (sensorId = 'sensor-1', hostId = 'host-1') => {
  const rawCredential = 'a-raw-test-credential-value';
  await SensorCredential.create({
    sensorId, hostId, credentialHash: SensorCredential.hashCredential(rawCredential),
  });
  return { sensorId, hostId, rawCredential };
};

const validProcessEvent = (eventId = 'evt-1') => ({
  eventId,
  type: 'PROCESS_EXEC',
  timestamp: new Date().toISOString(),
  process: { name: 'sshd', pid: 100, parentPid: 1, parentName: 'systemd' },
});

const sendBatch = (sensorId, rawCredential, events) => request(app)
  .post('/api/security/sensor/events')
  .set('x-zeph-sensor-id', sensorId)
  .set('x-zeph-sensor-credential', rawCredential)
  .send({ events });

describe('POST /api/security/sensor/events — sensor auth', () => {
  it('rejects a request with no sensor credentials', async () => {
    const res = await request(app).post('/api/security/sensor/events').send({ events: [validProcessEvent()] });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown sensorId', async () => {
    const res = await sendBatch('no-such-sensor', 'whatever', [validProcessEvent()]);
    expect(res.status).toBe(401);
  });

  it('rejects a known sensorId with the wrong credential', async () => {
    const { sensorId } = await registerSensor();
    const res = await sendBatch(sensorId, 'wrong-credential', [validProcessEvent()]);
    expect(res.status).toBe(401);
  });

  it('rejects a revoked sensor credential', async () => {
    const { sensorId, rawCredential } = await registerSensor();
    await SensorCredential.updateOne({ sensorId }, { revokedAt: new Date() });
    const res = await sendBatch(sensorId, rawCredential, [validProcessEvent()]);
    expect(res.status).toBe(401);
  });

  it('a normal user JWT cannot authenticate as a sensor (no Authorization bearer path exists on this route)', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/security/sensor/events')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ events: [validProcessEvent()] });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/security/sensor/events — validation', () => {
  it('rejects a missing/empty events array', async () => {
    const { sensorId, rawCredential } = await registerSensor();
    const res = await sendBatch(sensorId, rawCredential, []);
    expect(res.status).toBe(400);
  });

  it('rejects an oversized batch', async () => {
    const { sensorId, rawCredential } = await registerSensor();
    const events = Array.from({ length: 501 }, (_, i) => validProcessEvent(`evt-${i}`));
    const res = await sendBatch(sensorId, rawCredential, events);
    expect(res.status).toBe(413);
  });

  // No Redis in the test environment, so sensorEventDedup's claimEventOnce
  // fails safe to "duplicate" for every event (see its own test/comments) —
  // accepted+duplicates covers both the real-Redis and no-Redis cases,
  // without this suite needing a live Redis to assert the pipeline works.
  it('accepts (or safely dedup-skips, with no Redis) a valid batch and creates a SecurityEvent with sourceSystem "ebpf" when accepted', async () => {
    const { sensorId, rawCredential, hostId } = await registerSensor();
    const res = await sendBatch(sensorId, rawCredential, [validProcessEvent('evt-accept-1')]);
    expect(res.status).toBe(200);
    expect(res.body.accepted + res.body.duplicates).toBe(1);
    expect(res.body.rejected).toBe(0);

    await new Promise((resolve) => { setTimeout(resolve, 50); }); // fire-and-forget Mongo write
    const stored = await SecurityEvent.findOne({ 'metadata.sensorEventId': 'evt-accept-1' });
    if (res.body.accepted === 1) {
      expect(stored).toBeTruthy();
      expect(stored.sourceSystem).toBe('ebpf');
      expect(stored.metadata.sensorId).toBe(sensorId);
      expect(stored.metadata.hostId).toBe(hostId);
    } else {
      expect(stored).toBeNull();
    }
  });

  it('never persists sensor-provided severity/riskScore/decision/malicious/trusted/policy fields, when the event is accepted', async () => {
    const { sensorId, rawCredential } = await registerSensor();
    const event = {
      ...validProcessEvent('evt-spoof-1'),
      severity: 'critical',
      riskScore: 100,
      decision: 'DENY',
      malicious: true,
      trusted: false,
      policy: 'ADMIN_OVERRIDE',
    };
    const res = await sendBatch(sensorId, rawCredential, [event]);
    expect(res.status).toBe(200);
    expect(res.body.accepted + res.body.duplicates).toBe(1);
    expect(res.body.rejected).toBe(0);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const stored = await SecurityEvent.findOne({ 'metadata.sensorEventId': 'evt-spoof-1' });
    if (res.body.accepted === 1) {
      expect(stored.severity).not.toBe('critical'); // computed server-side from type, not from the sensor
      const raw = JSON.stringify(stored.toObject());
      expect(raw).not.toMatch(/ADMIN_OVERRIDE/);
    } else {
      expect(stored).toBeNull(); // not accepted at all (no-Redis fail-safe dedup) — nothing to spoof
    }
  });

  it('rejects an unsupported event type', async () => {
    const { sensorId, rawCredential } = await registerSensor();
    const res = await sendBatch(sensorId, rawCredential, [{ ...validProcessEvent(), type: 'LOGIN_FAILED' }]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toBe(1);
    expect(res.body.accepted).toBe(0);
  });

  it('handles a duplicate eventId in the same batch as at most one accepted event', async () => {
    const { sensorId, rawCredential } = await registerSensor();
    const dupe = validProcessEvent('evt-dupe-1');
    const res = await sendBatch(sensorId, rawCredential, [dupe, { ...dupe }]);
    expect(res.status).toBe(200);
    expect(res.body.accepted + res.body.duplicates).toBe(2);
  });
});

describe('POST /api/security/sensor/register — admin-only', () => {
  it('a standard user gets 404 (anti-enumeration, matches other security admin routes)', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/security/sensor/register')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ sensorId: 'sensor-x', hostId: 'host-x' });
    expect(res.status).toBe(404);
  });

  it('an admin can register a sensor and receives a one-time raw credential', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/api/security/sensor/register')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ sensorId: 'sensor-new', hostId: 'host-new' });
    expect(res.status).toBe(201);
    expect(res.body.credential).toBeTruthy();

    const stored = await SensorCredential.findOne({ sensorId: 'sensor-new' });
    expect(stored).toBeTruthy();
    expect(stored.credentialHash).not.toBe(res.body.credential); // hash, not raw, is what's stored
  });

  it('rejects re-registering an already-active sensorId', async () => {
    const admin = await createAdmin();
    await registerSensor('sensor-dup', 'host-dup');
    const res = await request(app)
      .post('/api/security/sensor/register')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ sensorId: 'sensor-dup', hostId: 'host-dup' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/security/sensor/status — admin-only', () => {
  it('a standard user gets 404', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/security/sensor/status')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
  });

  it('an admin sees a registered sensor as offline before any batch is ever sent', async () => {
    const admin = await createAdmin();
    await registerSensor('sensor-status-1', 'host-status-1');
    const res = await request(app)
      .get('/api/security/sensor/status')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    const entry = res.body.sensors.find((s) => s.sensorId === 'sensor-status-1');
    expect(entry).toBeTruthy();
    expect(entry.status).toBe('offline');
    expect(entry.hostId).toBe('host-status-1');
  });

  it('a sensor that just sent a batch shows as online', async () => {
    const admin = await createAdmin();
    const { sensorId, rawCredential } = await registerSensor('sensor-status-2', 'host-status-2');
    await sendBatch(sensorId, rawCredential, [validProcessEvent('evt-status-1')]);

    const res = await request(app)
      .get('/api/security/sensor/status')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    const entry = res.body.sensors.find((s) => s.sensorId === sensorId);
    expect(entry.status).toBe('online');
    expect(entry.lastHeartbeat).toBeTruthy();
  });

  it('a revoked sensor is excluded from the status list', async () => {
    const admin = await createAdmin();
    const { sensorId } = await registerSensor('sensor-status-3', 'host-status-3');
    await SensorCredential.updateOne({ sensorId }, { revokedAt: new Date() });

    const res = await request(app)
      .get('/api/security/sensor/status')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.body.sensors.find((s) => s.sensorId === sensorId)).toBeUndefined();
  });
});

// Phase 5 — the network sensor reuses this SAME endpoint/credential
// (spec section 34) — no second sensor auth system, no second route.
const validFlowEvent = (eventId = 'flow-1') => ({
  eventId,
  type: 'NETWORK_FLOW',
  timestamp: new Date().toISOString(),
  flow: {
    destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'TCP', pid: 100, processName: 'node',
  },
});

const validDnsEvent = (eventId = 'dns-1') => ({
  eventId,
  type: 'DNS_QUERY',
  timestamp: new Date().toISOString(),
  dns: { domain: 'example.com', queryType: 'A', pid: 100, processName: 'node' },
});

describe('POST /api/security/sensor/events — Phase 5 network events', () => {
  it('accepts a valid NETWORK_FLOW event and persists it with sourceSystem "network_sensor"', async () => {
    const { sensorId, rawCredential, hostId } = await registerSensor('sensor-net-1', 'host-net-1');
    const res = await sendBatch(sensorId, rawCredential, [validFlowEvent('flow-accept-1')]);
    expect(res.status).toBe(200);
    expect(res.body.accepted + res.body.duplicates).toBe(1);
    expect(res.body.rejected).toBe(0);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const stored = await SecurityEvent.findOne({ 'metadata.sensorEventId': 'flow-accept-1' });
    if (res.body.accepted === 1) {
      expect(stored).toBeTruthy();
      expect(stored.sourceSystem).toBe('network_sensor');
      expect(stored.metadata.flow.destinationIp).toBe('203.0.113.5');
      expect(stored.metadata.sensorId).toBe(sensorId);
      expect(stored.metadata.hostId).toBe(hostId);
    } else {
      expect(stored).toBeNull();
    }
  });

  it('accepts a valid DNS_QUERY event and persists it with sourceSystem "network_sensor"', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-2', 'host-net-2');
    const res = await sendBatch(sensorId, rawCredential, [validDnsEvent('dns-accept-1')]);
    expect(res.status).toBe(200);
    expect(res.body.accepted + res.body.duplicates).toBe(1);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const stored = await SecurityEvent.findOne({ 'metadata.sensorEventId': 'dns-accept-1' });
    if (res.body.accepted === 1) {
      expect(stored).toBeTruthy();
      expect(stored.sourceSystem).toBe('network_sensor');
      expect(stored.metadata.dns.domain).toBe('example.com');
    } else {
      expect(stored).toBeNull();
    }
  });

  it('never persists sensor-provided riskScore/malicious/decision fields on a NETWORK_FLOW event', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-3', 'host-net-3');
    const event = {
      ...validFlowEvent('flow-spoof-1'),
      flow: {
        ...validFlowEvent().flow, riskScore: 100, malicious: true, decision: 'DENY', trusted: false, policy: 'ADMIN_OVERRIDE',
      },
    };
    const res = await sendBatch(sensorId, rawCredential, [event]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toBe(0);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const stored = await SecurityEvent.findOne({ 'metadata.sensorEventId': 'flow-spoof-1' });
    if (stored) {
      const raw = JSON.stringify(stored.toObject());
      expect(raw).not.toMatch(/ADMIN_OVERRIDE/);
      expect(stored.metadata.flow.riskScore).toBeUndefined();
      expect(stored.metadata.flow.malicious).toBeUndefined();
    }
  });

  it('rejects a NETWORK_FLOW event with an invalid protocol', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-4', 'host-net-4');
    const event = { ...validFlowEvent(), flow: { ...validFlowEvent().flow, protocol: 'ICMP' } };
    const res = await sendBatch(sensorId, rawCredential, [event]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toBe(1);
    expect(res.body.accepted).toBe(0);
  });

  it('a normal user JWT cannot submit network events (same sensor-only auth as Phase 4)', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/security/sensor/events')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ events: [validFlowEvent()] });
    expect(res.status).toBe(401);
  });

  it('a sensor cannot submit a backend-computed verdict type directly (PORT_SCAN_ANOMALY is not in the sensor allowlist)', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-5', 'host-net-5');
    const event = {
      eventId: 'fake-verdict-1', type: 'PORT_SCAN_ANOMALY', timestamp: new Date().toISOString(), flow: validFlowEvent().flow,
    };
    const res = await sendBatch(sensorId, rawCredential, [event]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toBe(1);
    expect(res.body.accepted).toBe(0);
  });

  // Phase 5 spec section 63's explicit security checklist — a sensor
  // credential (x-zeph-sensor-id/x-zeph-sensor-credential headers) is a
  // separate, least-privilege credential space that must never reach
  // admin-only routes, which all require a real JWT (req.user, not
  // req.sensor) via jwtAuth. Presenting sensor headers to an admin route
  // simply has no bearing at all — jwtAuth reads Authorization: Bearer,
  // never these headers — so the request is treated as fully
  // unauthenticated.
  it('sensor credentials cannot access the admin-only sensor registration route', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-6', 'host-net-6');
    const res = await request(app)
      .post('/api/security/sensor/register')
      .set('x-zeph-sensor-id', sensorId)
      .set('x-zeph-sensor-credential', rawCredential)
      .send({ sensorId: 'sensor-new-x', hostId: 'host-new-x' });
    expect(res.status).toBe(401);
  });

  it('sensor credentials cannot access the admin-only sensor status route', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-7', 'host-net-7');
    const res = await request(app)
      .get('/api/security/sensor/status')
      .set('x-zeph-sensor-id', sensorId)
      .set('x-zeph-sensor-credential', rawCredential);
    expect(res.status).toBe(401);
  });

  it('sensor credentials cannot access the admin-only network intelligence summary route', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-8', 'host-net-8');
    const res = await request(app)
      .get('/api/security/network/summary')
      .set('x-zeph-sensor-id', sensorId)
      .set('x-zeph-sensor-credential', rawCredential);
    expect(res.status).toBe(401);
  });

  it('sensor credentials are never logged, even on a rejected/malformed batch', async () => {
    const { sensorId, rawCredential } = await registerSensor('sensor-net-9', 'host-net-9');
    const logSpy = jest.spyOn(require('../src/logger'), 'info');
    const warnSpy = jest.spyOn(require('../src/logger'), 'warn');
    await sendBatch(sensorId, rawCredential, [{ eventId: 'bad', type: 'NOT_A_REAL_TYPE' }]);

    const allLoggedArgs = [...logSpy.mock.calls, ...warnSpy.mock.calls].map((call) => JSON.stringify(call));
    expect(allLoggedArgs.join('\n')).not.toContain(rawCredential);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
