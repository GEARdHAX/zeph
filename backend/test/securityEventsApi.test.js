const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const SecurityEvent = require('../src/models/SecurityEvent');
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

// Bypasses record()'s own async fire-and-forget write so tests get
// deterministic, immediately-queryable fixtures instead of racing the
// service's own Mongo write.
const seedEvent = (overrides = {}) => SecurityEvent.create({
  eventId: overrides.eventId || `evt-${Math.random().toString(36).slice(2)}`,
  timestamp: overrides.timestamp || new Date(),
  type: overrides.type || 'LOGIN_SUCCESS',
  severity: overrides.severity || 'low',
  actor: overrides.actor || { userId: null, sessionId: null },
  source: overrides.source || { ip: null, userAgent: null, deviceId: null },
  target: overrides.target || { resource: null, resourceId: null, action: null },
  result: overrides.result || 'success',
  metadata: overrides.metadata || {},
  requestId: overrides.requestId || null,
  sourceSystem: overrides.sourceSystem || 'app',
});

describe('GET /api/security/events — RBAC', () => {
  it('returns 404 (not 403) for a standard user — indistinguishable from a nonexistent route', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/security/events')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const res = await request(app).get('/api/security/events');
    expect(res.status).toBe(401);
  });

  it('allows an admin (level:root) user through', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/events')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('the admin\'s own access is itself recorded as a ZERO_TRUST_ALLOW event (eventually — record() never blocks the request it instruments)', async () => {
    const admin = await createAdmin();
    await request(app)
      .get('/api/security/events')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    // record() is fire-and-forget by design (services/securityEventService.js
    // — a Mongo write must never slow down or fail the request it's
    // instrumenting), so the write for THIS request's own ZERO_TRUST_ALLOW
    // event can genuinely still be in flight when the handler's list query
    // above already ran — same eventual-consistency wait the "End-to-end"
    // describe block below already uses for the identical reason.
    await new Promise((resolve) => { setTimeout(resolve, 100); });

    const followUp = await request(app)
      .get('/api/security/events?type=ZERO_TRUST_ALLOW')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(followUp.body.events.length).toBeGreaterThanOrEqual(1);
  });

  it('a standard user cannot fetch a single event by id either', async () => {
    const user = await createUser();
    await seedEvent({ eventId: 'evt-visible' });

    const res = await request(app)
      .get('/api/security/events/evt-visible')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/security/events — listing, pagination, filtering', () => {
  it('lists events newest-first', async () => {
    // Filtered by type — see the RBAC describe block's "allows an admin"
    // test for why the call itself also produces a ZERO_TRUST_ALLOW event
    // that would otherwise sort first (its timestamp is "now", newer than
    // either seeded fixture).
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-1', timestamp: new Date('2024-01-01T00:00:00Z') });
    await seedEvent({ eventId: 'evt-2', timestamp: new Date('2024-01-02T00:00:00Z') });

    const res = await request(app)
      .get('/api/security/events?type=LOGIN_SUCCESS')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.events.map((e) => e.eventId)).toEqual(['evt-2', 'evt-1']);
  });

  it('paginates via cursor, bounded by limit', async () => {
    const admin = await createAdmin();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await seedEvent({ eventId: `evt-${i}`, timestamp: new Date(Date.now() + i * 1000) });
    }

    const firstPage = await request(app)
      .get('/api/security/events?limit=2')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(firstPage.body.events).toHaveLength(2);
    expect(firstPage.body.cursor).not.toBeNull();

    const secondPage = await request(app)
      .get(`/api/security/events?limit=2&cursor=${encodeURIComponent(firstPage.body.cursor)}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(secondPage.body.events).toHaveLength(2);

    const firstIds = firstPage.body.events.map((e) => e.eventId);
    const secondIds = secondPage.body.events.map((e) => e.eventId);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  it('clamps an excessive limit to the max', async () => {
    const admin = await createAdmin();
    await seedEvent();

    const res = await request(app)
      .get('/api/security/events?limit=99999')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.limit).toBe(100);
  });

  it('filters by type', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-login', type: 'LOGIN_SUCCESS' });
    await seedEvent({ eventId: 'evt-logout', type: 'LOGOUT' });

    const res = await request(app)
      .get('/api/security/events?type=LOGOUT')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].eventId).toBe('evt-logout');
  });

  it('rejects an unknown type filter with 400, not silently returning nothing', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/events?type=NOT_A_REAL_TYPE')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(400);
  });

  it('filters by severity', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-low', severity: 'low' });
    await seedEvent({ eventId: 'evt-crit', severity: 'critical' });

    const res = await request(app)
      .get('/api/security/events?severity=critical')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events.map((e) => e.eventId)).toEqual(['evt-crit']);
  });

  it('filters by userId', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-a', actor: { userId: 'user-a' } });
    await seedEvent({ eventId: 'evt-b', actor: { userId: 'user-b' } });

    const res = await request(app)
      .get('/api/security/events?userId=user-a')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events.map((e) => e.eventId)).toEqual(['evt-a']);
  });

  it('filters by IP', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-a', source: { ip: '1.1.1.1' } });
    await seedEvent({ eventId: 'evt-b', source: { ip: '2.2.2.2' } });

    const res = await request(app)
      .get('/api/security/events?ip=2.2.2.2')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events.map((e) => e.eventId)).toEqual(['evt-b']);
  });

  it('filters by result', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-ok', result: 'success' });
    await seedEvent({ eventId: 'evt-fail', result: 'failure' });

    const res = await request(app)
      .get('/api/security/events?result=failure')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events.map((e) => e.eventId)).toEqual(['evt-fail']);
  });

  it('filters by startDate/endDate range', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-early', timestamp: new Date('2024-01-01T00:00:00Z') });
    await seedEvent({ eventId: 'evt-mid', timestamp: new Date('2024-06-01T00:00:00Z') });
    await seedEvent({ eventId: 'evt-late', timestamp: new Date('2024-12-01T00:00:00Z') });

    const res = await request(app)
      .get('/api/security/events?startDate=2024-03-01T00:00:00Z&endDate=2024-09-01T00:00:00Z')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events.map((e) => e.eventId)).toEqual(['evt-mid']);
  });

  it('rejects a malformed date filter with 400', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/events?startDate=not-a-date')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(400);
  });

  it('omits metadata from the list view', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-meta', metadata: { secretish: 'detail' } });

    const res = await request(app)
      .get('/api/security/events?type=LOGIN_SUCCESS')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].metadata).toBeUndefined();
  });
});

describe('GET /api/security/events/:eventId — detail view', () => {
  it('returns the full event including metadata', async () => {
    const admin = await createAdmin();
    await seedEvent({ eventId: 'evt-detail', metadata: { reason: 'bad_password' } });

    const res = await request(app)
      .get('/api/security/events/evt-detail')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.event.eventId).toBe('evt-detail');
    expect(res.body.event.metadata.reason).toBe('bad_password');
  });

  it('returns 404 for a nonexistent eventId', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/security/events/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(404);
  });
});

describe('End-to-end: SecurityEventService.record() -> queryable via the API', () => {
  it('an event recorded through the service is visible through the list API', async () => {
    const admin = await createAdmin();
    const eventId = SecurityEventService.record({
      type: 'LOGIN_FAILED',
      severity: 'medium',
      source: { ip: '9.9.9.9' },
      result: 'failure',
    });
    // record() writes to Mongo asynchronously — give it a tick to land.
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    const res = await request(app)
      .get('/api/security/events?type=LOGIN_FAILED')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.body.events.some((e) => e.eventId === eventId)).toBe(true);
  });
});
