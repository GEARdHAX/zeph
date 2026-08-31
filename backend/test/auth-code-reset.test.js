const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenForDevice } = require('./helpers/app');
const User = require('../src/models/User');
const AuthCode = require('../src/models/AuthCode');
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

const createUser = async (overrides = {}) => {
  const password = await argon2.hash('oldpassword123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
    accountStatus: overrides.accountStatus || 'ACTIVE',
  });
};

const GENERIC = 'If an account exists for this email, a code has been sent.';

describe('POST /api/auth/code — request a reset code', () => {
  it('returns the generic response and creates no AuthCode for an unknown email', async () => {
    const res = await request(app).post('/api/auth/code').field('email', 'nobody@example.com');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);
    expect(await AuthCode.countDocuments()).toBe(0);
  });

  it('returns the generic response and creates no AuthCode for a deleted account', async () => {
    const user = await createUser({ email: 'deleted@example.com', accountStatus: 'DELETED' });
    const res = await request(app).post('/api/auth/code').field('email', user.email);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);
    expect(await AuthCode.countDocuments()).toBe(0);
  });

  it('creates a valid AuthCode for an existing active account, same generic response', async () => {
    const user = await createUser({ email: 'active@example.com' });
    const res = await request(app).post('/api/auth/code').field('email', user.email);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);
    const codes = await AuthCode.find({ user: user._id });
    expect(codes).toHaveLength(1);
    expect(codes[0].valid).toBe(true);
  });

  it('rate-limits repeated requests for the same email', async () => {
    const user = await createUser({ email: 'ratelimited@example.com' });
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post('/api/auth/code').field('email', user.email);
    }
    const before = await AuthCode.countDocuments({ user: user._id });

    const res = await request(app).post('/api/auth/code').field('email', user.email);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);
    expect(await AuthCode.countDocuments({ user: user._id })).toBe(before);
  });
});

describe('POST /api/auth/change — consume a reset code', () => {
  const requestCode = async (email) => {
    await request(app).post('/api/auth/code').field('email', email);
    const code = await AuthCode.findOne({}).sort({ _id: -1 });
    return code.code;
  };

  it('changes the password with a valid code, then the code cannot be reused (replay)', async () => {
    const user = await createUser({ email: 'replay@example.com' });
    const code = await requestCode(user.email);

    const first = await request(app)
      .post('/api/auth/change')
      .field('email', user.email)
      .field('code', code)
      .field('password', 'newpassword123');
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/change')
      .field('email', user.email)
      .field('code', code)
      .field('password', 'anotherpassword123');
    expect(second.status).toBe(404);
    expect(second.body.code).toBe('Invalid or expired code.');
  });

  it('only one of two concurrent submissions of the same code succeeds', async () => {
    const user = await createUser({ email: 'race@example.com' });
    const code = await requestCode(user.email);

    const submit = () => request(app)
      .post('/api/auth/change')
      .field('email', user.email)
      .field('code', code)
      .field('password', 'racedpassword123');

    const [a, b] = await Promise.all([submit(), submit()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 404]);
  });

  it('rejects an expired code', async () => {
    const user = await createUser({ email: 'expired@example.com' });
    const code = await requestCode(user.email);
    await AuthCode.updateOne({ user: user._id }, { $set: { expires: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post('/api/auth/change')
      .field('email', user.email)
      .field('code', code)
      .field('password', 'newpassword123');

    expect(res.status).toBe(404);
    const stillOld = await argon2.verify(
      (await User.findById(user._id)).password,
      'oldpassword123',
    );
    expect(stillOld).toBe(true);
  });

  it('on success: old password fails, new password succeeds, and all sessions are revoked', async () => {
    const user = await createUser({ email: 'fullflow@example.com' });
    const { session } = await tokenForDevice(user);
    expect(session.revokedAt).toBeNull();

    const code = await requestCode(user.email);
    const res = await request(app)
      .post('/api/auth/change')
      .field('email', user.email)
      .field('code', code)
      .field('password', 'brandnewpassword123');
    expect(res.status).toBe(200);

    const oldLogin = await request(app).post('/api/login').field('email', user.email).field('password', 'oldpassword123');
    expect(oldLogin.status).toBe(400);

    const newLogin = await request(app).post('/api/login').field('email', user.email).field('password', 'brandnewpassword123');
    expect(newLogin.status).toBe(200);

    const revokedSession = await Session.findById(session._id);
    expect(revokedSession.revokedAt).not.toBeNull();
  });

  it('does not revoke a session created after the reset', async () => {
    const user = await createUser({ email: 'postreset@example.com' });
    const code = await requestCode(user.email);
    await request(app)
      .post('/api/auth/change')
      .field('email', user.email)
      .field('code', code)
      .field('password', 'brandnewpassword123');

    const { session } = await tokenForDevice(user);
    expect(session.revokedAt).toBeNull();
  });
});

// Phase 7 audit finding: AuthCode had zero indexes at all — every
// verification query (findOne({ code, user, valid: true })) did a full
// collection scan, and there was no TTL cleanup despite having an expiry
// field (unlike GroupInvite/StepUpToken, which both already TTL-clean
// themselves). Verifies the fix is actually declared on the schema.
describe('AuthCode indexes', () => {
  it('has a {user,valid} compound index covering the verification and invalidate-previous queries', () => {
    const indexes = AuthCode.schema.indexes();
    const hasUserValidIndex = indexes.some(([fields]) => fields.user === 1 && fields.valid === 1);
    expect(hasUserValidIndex).toBe(true);
  });

  it('has a TTL index on expires so old codes are automatically cleaned up', () => {
    const indexes = AuthCode.schema.indexes();
    const ttlIndex = indexes.find(([fields]) => Object.prototype.hasOwnProperty.call(fields, 'expires'));
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex[1].expireAfterSeconds).toBe(0);
  });
});
