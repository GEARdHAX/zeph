const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const PasskeyCredential = require('../src/models/PasskeyCredential');

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

const createUser = async (over = {}) => {
  const password = await argon2.hash('password123');
  return User.create({
    username: over.username || `user-${Math.random().toString(36).slice(2)}`,
    email: over.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

// A stored credential — the full WebAuthn ceremony needs a real
// authenticator, so these tests cover everything AROUND the crypto:
// auth gates, IDOR isolation, and the no-enumeration guarantee.
const seedCred = (user, over = {}) =>
  PasskeyCredential.create({
    user: user._id,
    credentialID: over.credentialID || `cred-${Math.random().toString(36).slice(2)}`,
    publicKey: Buffer.from('fake-public-key'),
    counter: 0,
    transports: ['internal'],
    label: over.label || 'My phone',
  });

describe('passkey management routes require auth', () => {
  it('GET /api/passkey/list is 401 without a token', async () => {
    const res = await request(app).get('/api/passkey/list');
    expect(res.status).toBe(401);
  });

  it('POST /api/passkey/register/options is 401 without a token', async () => {
    const res = await request(app).post('/api/passkey/register/options');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/passkey/list', () => {
  it("returns only the caller's own passkeys and never the public key", async () => {
    const me = await createUser();
    const other = await createUser();
    await seedCred(me, { label: 'mine' });
    await seedCred(other, { label: 'theirs' });

    const res = await request(app)
      .get('/api/passkey/list')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(res.body.passkeys).toHaveLength(1);
    expect(res.body.passkeys[0].label).toBe('mine');
    expect(res.body.passkeys[0].publicKey).toBeUndefined();
    expect(res.body.passkeys[0].counter).toBeUndefined();
  });
});

describe('POST /api/passkey/:id/delete — IDOR', () => {
  it("cannot delete another user's passkey", async () => {
    const me = await createUser();
    const other = await createUser();
    const victim = await seedCred(other);

    const res = await request(app)
      .post(`/api/passkey/${victim._id}/delete`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(404);
    expect(await PasskeyCredential.findById(victim._id)).not.toBeNull();
  });

  it('deletes your own passkey', async () => {
    const me = await createUser();
    const mine = await seedCred(me);

    const res = await request(app)
      .post(`/api/passkey/${mine._id}/delete`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(await PasskeyCredential.findById(mine._id)).toBeNull();
  });
});

describe('POST /api/passkey/login/options — usernameless + no enumeration', () => {
  it('works with no identifier at all (discoverable-credential flow)', async () => {
    const res = await request(app).post('/api/passkey/login/options');

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeDefined();
    expect(res.body.flowId).toBeDefined();
    expect(res.body.allowCredentials).toEqual([]);
  });

  it('returns a well-formed options object for an unknown user', async () => {
    const res = await request(app).post('/api/passkey/login/options').field('email', 'nobody-here');

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeDefined();
    expect(res.body.allowCredentials).toEqual([]);
  });

  it('shape is identical for a known user with a passkey (no distinguishing 404)', async () => {
    const user = await createUser({ username: 'haspasskey' });
    await seedCred(user);

    const res = await request(app).post('/api/passkey/login/options').field('email', 'haspasskey');

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeDefined();
    expect(res.body.flowId).toBeDefined();
  });
});

describe('POST /api/passkey/login/verify — opaque failure', () => {
  it('401 with a generic reason for a garbage response (valid flowId)', async () => {
    const opts = await request(app).post('/api/passkey/login/options');
    const res = await request(app)
      .post('/api/passkey/login/verify')
      .field('flowId', opts.body.flowId)
      .field('response', JSON.stringify({ id: 'no-such-cred', response: {} }));

    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('passkey_auth_failed');
    expect(res.body.token).toBeUndefined();
  });

  it('401 when no flowId is supplied', async () => {
    const res = await request(app)
      .post('/api/passkey/login/verify')
      .field('response', JSON.stringify({ id: 'x', response: {} }));

    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('passkey_auth_failed');
  });

  it('flowId is single-use — a second verify with the same flowId fails', async () => {
    const opts = await request(app).post('/api/passkey/login/options');
    const body = { flowId: opts.body.flowId, response: JSON.stringify({ id: 'x', response: {} }) };

    await request(app).post('/api/passkey/login/verify').field('flowId', body.flowId).field('response', body.response);
    const second = await request(app)
      .post('/api/passkey/login/verify')
      .field('flowId', body.flowId)
      .field('response', body.response);

    expect(second.status).toBe(401);
  });

  it('401 for a malformed (non-JSON) response', async () => {
    const res = await request(app).post('/api/passkey/login/verify').field('response', 'not json');

    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('passkey_auth_failed');
  });
});
