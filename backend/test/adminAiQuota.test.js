const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const store = require('../src/store');
const config = require('../config');
const User = require('../src/models/User');
const { resetUserQuota, getUserQuota, QUOTA_TYPES } = require('../src/ai/quota');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(() => {
  store.config = { ...config, redisUrl: null };
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
const createAdmin = () => createUser({ level: 'root' });

describe('quota.js — reset/get helpers with no Redis', () => {
  it('QUOTA_TYPES is the expected set', () => {
    expect(QUOTA_TYPES).toEqual(['minute', 'day', 'concurrent']);
  });

  it('getUserQuota returns null when Redis is not configured', async () => {
    expect(await getUserQuota('u1')).toBeNull();
  });

  it('resetUserQuota returns REDIS_UNAVAILABLE when Redis is not configured', async () => {
    expect(await resetUserQuota('u1', ['all'])).toEqual({ ok: false, reason: 'REDIS_UNAVAILABLE' });
  });
});

describe('GET /api/admin/ai-quota/:userId', () => {
  it('404s for a non-admin (does not leak that the route exists)', async () => {
    const member = await createUser();
    const target = await createUser();
    const res = await request(app)
      .get(`/api/admin/ai-quota/${target._id}`)
      .set('Authorization', `Bearer ${tokenFor(member)}`);
    expect(res.status).toBe(404);
  });

  it('404s for a non-existent target user (admin caller)', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get('/api/admin/ai-quota/000000000000000000000000')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(404);
  });

  it('returns the user + limits + null usage (no Redis) for an admin', async () => {
    const admin = await createAdmin();
    const target = await createUser({ username: 'target-user' });
    const res = await request(app)
      .get(`/api/admin/ai-quota/${target._id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('target-user');
    expect(res.body.usage).toBeNull(); // no Redis in the test harness
    expect(res.body.limits).toEqual({ perMinute: 5, perDay: 50, concurrent: 2 });
  });
});

describe('POST /api/admin/ai-quota/reset', () => {
  it('404s for a non-admin', async () => {
    const member = await createUser();
    const target = await createUser();
    const res = await request(app)
      .post('/api/admin/ai-quota/reset')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ userId: target._id.toString(), types: 'all' });
    expect(res.status).toBe(404);
  });

  it('400s when userId is missing', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/api/admin/ai-quota/reset')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ types: 'all' });
    expect(res.status).toBe(400);
  });

  it('400s when types is empty or invalid', async () => {
    const admin = await createAdmin();
    const target = await createUser();
    const res = await request(app)
      .post('/api/admin/ai-quota/reset')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: target._id.toString(), types: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('404s for a non-existent target user', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/api/admin/ai-quota/reset')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: '000000000000000000000000', types: 'all' });
    expect(res.status).toBe(404);
  });

  it('409s when Redis is not configured (nothing to reset)', async () => {
    const admin = await createAdmin();
    const target = await createUser();
    const res = await request(app)
      .post('/api/admin/ai-quota/reset')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: target._id.toString(), types: 'minute,day' });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('REDIS_UNAVAILABLE');
  });
});
