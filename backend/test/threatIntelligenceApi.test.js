const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const ThreatIndicator = require('../src/models/ThreatIndicator');

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

const seedIndicator = (overrides = {}) => ThreatIndicator.create({
  indicator: overrides.indicator || '203.0.113.10',
  normalizedIndicator: overrides.normalizedIndicator || '203.0.113.10',
  type: overrides.type || 'IP',
  status: overrides.status || 'MALICIOUS',
  confidence: overrides.confidence ?? 90,
  severity: overrides.severity || 'high',
  categories: overrides.categories || ['ABUSE'],
  source: overrides.source || 'abuseipdb',
  firstSeen: overrides.firstSeen || new Date(),
  lastSeen: overrides.lastSeen || new Date(),
  expiresAt: overrides.expiresAt || new Date(Date.now() + 60 * 60 * 1000),
  metadata: overrides.metadata || {},
});

describe('GET /api/security/threat-intelligence — RBAC (spec section 28/41)', () => {
  it('a standard user gets 404, not 403 (same anti-enumeration convention as security/events)', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/security/threat-intelligence')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
  });

  it('an unauthenticated request gets 401', async () => {
    const res = await request(app).get('/api/security/threat-intelligence');
    expect(res.status).toBe(401);
  });

  it('an admin gets through', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/threat-intelligence')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.indicators)).toBe(true);
  });
});

describe('GET /api/security/threat-intelligence — listing and filtering', () => {
  it('lists indicators newest-updated-first', async () => {
    const admin = await createAdmin();
    await seedIndicator({ indicator: '203.0.113.1', normalizedIndicator: '203.0.113.1' });
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    await seedIndicator({ indicator: '203.0.113.2', normalizedIndicator: '203.0.113.2' });

    const res = await request(app)
      .get('/api/security/threat-intelligence')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.indicators.map((i) => i.normalizedIndicator)).toEqual(['203.0.113.2', '203.0.113.1']);
  });

  it('filters by type', async () => {
    const admin = await createAdmin();
    await seedIndicator({ normalizedIndicator: '203.0.113.5', type: 'IP' });
    await seedIndicator({
      normalizedIndicator: 'evil.example.com', type: 'DOMAIN', indicator: 'evil.example.com',
    });

    const res = await request(app)
      .get('/api/security/threat-intelligence?type=DOMAIN')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.indicators).toHaveLength(1);
    expect(res.body.indicators[0].type).toBe('DOMAIN');
  });

  it('rejects an invalid type filter with 400', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/threat-intelligence?type=NOT_REAL')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(400);
  });

  it('filters by malicious=true', async () => {
    const admin = await createAdmin();
    await seedIndicator({ normalizedIndicator: '203.0.113.6', status: 'MALICIOUS' });
    await seedIndicator({ normalizedIndicator: '203.0.113.7', status: 'CLEAN' });

    const res = await request(app)
      .get('/api/security/threat-intelligence?malicious=true')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.indicators).toHaveLength(1);
    expect(res.body.indicators[0].status).toBe('MALICIOUS');
  });

  it('filters by severity', async () => {
    const admin = await createAdmin();
    await seedIndicator({ normalizedIndicator: '203.0.113.8', severity: 'critical' });
    await seedIndicator({ normalizedIndicator: '203.0.113.9', severity: 'low' });

    const res = await request(app)
      .get('/api/security/threat-intelligence?severity=critical')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.indicators).toHaveLength(1);
  });

  it('paginates via cursor, bounded by limit', async () => {
    const admin = await createAdmin();
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await seedIndicator({ normalizedIndicator: `203.0.113.${20 + i}` });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }

    const firstPage = await request(app)
      .get('/api/security/threat-intelligence?limit=2')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(firstPage.body.indicators).toHaveLength(2);
    expect(firstPage.body.cursor).not.toBeNull();

    const secondPage = await request(app)
      .get(`/api/security/threat-intelligence?limit=2&cursor=${encodeURIComponent(firstPage.body.cursor)}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(secondPage.body.indicators).toHaveLength(2);

    const firstIds = firstPage.body.indicators.map((i) => i.normalizedIndicator);
    const secondIds = secondPage.body.indicators.map((i) => i.normalizedIndicator);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });
});

describe('GET /api/security/threat-intelligence/:indicator — manual lookup (spec section 29)', () => {
  it('returns the full persisted record for a known indicator', async () => {
    const admin = await createAdmin();
    await seedIndicator({ normalizedIndicator: '203.0.113.10', confidence: 94 });

    const res = await request(app)
      .get('/api/security/threat-intelligence/203.0.113.10')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.indicator.confidence).toBe(94);
  });

  it('normalizes the path param before looking up (case-insensitive)', async () => {
    const admin = await createAdmin();
    await seedIndicator({
      normalizedIndicator: 'evil.example.com', type: 'DOMAIN', indicator: 'evil.example.com',
    });

    const res = await request(app)
      .get('/api/security/threat-intelligence/EVIL.EXAMPLE.COM')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
  });

  it('returns 404 for an indicator with no record', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/threat-intelligence/198.51.100.1')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for a garbage/unparseable indicator', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/threat-intelligence/not-a-valid-anything')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(400);
  });

  it('a standard user gets 404, never learning whether the indicator exists', async () => {
    const user = await createUser();
    await seedIndicator({ normalizedIndicator: '203.0.113.10' });
    const res = await request(app)
      .get('/api/security/threat-intelligence/203.0.113.10')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/security/threat-intelligence/status — provider health (spec section 36)', () => {
  it('never exposes the API key', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/threat-intelligence/status')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/apiKey|api_key/i);
    expect(res.body).not.toHaveProperty('abuseIpDbApiKey');
  });

  it('reports provider status fields', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/threat-intelligence/status')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body).toHaveProperty('provider');
    expect(res.body).toHaveProperty('circuitState');
    expect(res.body).toHaveProperty('dailyBudget');
    expect(res.body).toHaveProperty('remainingToday');
  });

  it('a standard user is blocked from status too', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/security/threat-intelligence/status')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
  });

  it('the literal "status" path is not swallowed by the :indicator route (registration-order correctness)', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/threat-intelligence/status')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    // If :indicator had matched "status" as a literal indicator string
    // first, this would 400 (INVALID_INDICATOR) instead of 200.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('circuitState');
  });
});
