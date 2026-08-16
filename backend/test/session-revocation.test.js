const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor, tokenForDevice } = require('./helpers/app');
const User = require('../src/models/User');
const Session = require('../src/models/Session');

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

const createUser = async () => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

describe('Device sessions: legacy-token compatibility', () => {
  it('accepts a token with no deviceId claim (pre-migration tokens keep working)', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    // Legacy tokens are trusted for general auth (unaffected), but have no
    // deviceId to filter by, so the sessions list is legitimately empty.
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
  });
});

describe('Device sessions: revocation', () => {
  it('rejects requests once the session backing the token is revoked', async () => {
    const user = await createUser();
    const { token, session } = await tokenForDevice(user);

    const before = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });

    const after = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('a user cannot revoke another user\'s session (IDOR check)', async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const { session: ownerSession } = await tokenForDevice(owner);
    const { token: attackerToken } = await tokenForDevice(attacker);

    const res = await request(app)
      .post('/api/sessions/revoke')
      .set('Authorization', `Bearer ${attackerToken}`)
      .field('id', ownerSession._id.toString());

    expect(res.status).toBe(404);
    const stillActive = await Session.findById(ownerSession._id);
    expect(stillActive.revokedAt).toBeNull();
  });

  it('revoking your own session works and is reflected in the sessions list', async () => {
    const user = await createUser();
    const { token: tokenA, session: sessionA } = await tokenForDevice(user);
    const { token: tokenB } = await tokenForDevice(user);

    const revokeRes = await request(app)
      .post('/api/sessions/revoke')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('id', sessionA._id.toString());
    expect(revokeRes.status).toBe(200);

    const listRes = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.sessions).toHaveLength(1);
    expect(listRes.body.sessions[0].isCurrent).toBe(true);

    const revokedTokenRes = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(revokedTokenRes.status).toBe(401);
  });
});

describe('POST /api/logout', () => {
  it('revokes the calling session so the same token stops working afterwards', async () => {
    const user = await createUser();
    const { token, session } = await tokenForDevice(user);

    const logoutRes = await request(app)
      .post('/api/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);

    const stored = await Session.findById(session._id);
    expect(stored.revokedAt).not.toBeNull();

    const afterLogout = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
  });
});
