const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');

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
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    password,
  });
};

describe('Search hardening regression: POST /api/search', () => {
  it('treats regex metacharacters in the search term as literal text, not a pattern', async () => {
    const requester = await createUser();
    await createUser({ firstName: 'A+B', lastName: 'Match' });
    await createUser({ firstName: 'AAAB', lastName: 'NoMatch' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(requester)}`)
      .field('search', 'A+B');

    expect(res.status).toBe(200);
    // Regex-injection would match "AAAB" too (since "+" would mean "one or more A"); literal escaping must not.
    expect(res.body.users.some((u) => u.firstName === 'AAAB')).toBe(false);
    expect(res.body.users.some((u) => u.firstName === 'A+B')).toBe(true);
  });

  it('caps a client-supplied limit at the server-side maximum instead of trusting it directly', async () => {
    const requester = await createUser();
    for (let i = 0; i < 5; i++) {
      await createUser({ firstName: `Bulk${i}` });
    }

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(requester)}`)
      .field('search', 'Bulk')
      .field('limit', '999999999');

    expect(res.status).toBe(200);
    expect(res.body.limit).toBeLessThanOrEqual(50);
  });
});
