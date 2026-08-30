const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const SecurityEventService = require('../src/services/securityEventService');

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

const flush = () => new Promise((resolve) => { setTimeout(resolve, 100); });

describe('GET /api/security/network/summary — admin-only', () => {
  it('a standard user gets 404', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/security/network/summary')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
  });

  it('an admin gets an empty summary with no network alerts', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/network/summary')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.recentAlerts).toEqual([]);
    expect(res.body.topSuspiciousDestinations).toEqual([]);
  });

  it('surfaces a recent PORT_SCAN_ANOMALY in recentAlerts and countsByType', async () => {
    const admin = await createAdmin();
    SecurityEventService.record({
      type: 'PORT_SCAN_ANOMALY',
      severity: 'high',
      target: { resource: 'network', action: 'port_scan_anomaly' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: { sensorId: 's1', destinationIp: '203.0.113.5', distinctPorts: 20 },
    });
    await flush();

    const res = await request(app)
      .get('/api/security/network/summary')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.recentAlerts.length).toBe(1);
    expect(res.body.recentAlerts[0].type).toBe('PORT_SCAN_ANOMALY');
    expect(res.body.countsByType.PORT_SCAN_ANOMALY).toBe(1);
  });

  it('aggregates top suspicious destinations by alert count', async () => {
    const admin = await createAdmin();
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < 3; i += 1) {
      SecurityEventService.record({
        type: 'THREAT_INTEL_NETWORK_MATCH',
        severity: 'high',
        target: { resource: 'network', action: 'threat_intel_network_match' },
        result: 'unknown',
        sourceSystem: 'network_sensor',
        metadata: { sensorId: 's1', destinationIp: '198.51.100.66' },
      });
    }
    await flush();

    const res = await request(app)
      .get('/api/security/network/summary')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.topSuspiciousDestinations[0]).toEqual(expect.objectContaining({
      destinationIp: '198.51.100.66', count: 3,
    }));
  });

  it('does not include ordinary NETWORK_FLOW observations as alerts', async () => {
    const admin = await createAdmin();
    SecurityEventService.record({
      type: 'NETWORK_FLOW',
      severity: 'low',
      target: { resource: 'network', action: 'network_flow' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: { sensorId: 's1', flow: { destinationIp: '203.0.113.9' } },
    });
    await flush();

    const res = await request(app)
      .get('/api/security/network/summary')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.body.recentAlerts).toEqual([]);
    expect(res.body.countsByType.NETWORK_FLOW).toBeUndefined();
  });
});
