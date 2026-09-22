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
    firstName: 'Test',
    lastName: 'User',
    password,
    level: overrides.level || 'standard',
  });
};

const suspend = (actor, userId, suspended = true) =>
  request(app)
    .post('/api/admin/user/suspend')
    .set('Authorization', `Bearer ${tokenFor(actor)}`)
    .send({ userId, suspended });

describe('POST /api/admin/user/suspend', () => {
  it('rejects a standard user with 404 (anti-enumeration)', async () => {
    const standard = await createUser();
    const target = await createUser();
    const res = await suspend(standard, target._id.toString());
    expect(res.status).toBe(404);
  });

  it('allows a privileged admin to suspend a standard account', async () => {
    const admin = await createUser({ level: 'admin' });
    const target = await createUser();

    const res = await suspend(admin, target._id.toString());
    expect(res.status).toBe(200);
    expect(res.body.accountStatus).toBe('DEACTIVATED');

    const updated = await User.findById(target._id);
    expect(updated.accountStatus).toBe('DEACTIVATED');
  });

  it('allows reactivating a suspended account', async () => {
    const admin = await createUser({ level: 'admin' });
    const target = await createUser();
    await suspend(admin, target._id.toString(), true);

    const res = await suspend(admin, target._id.toString(), false);
    expect(res.status).toBe(200);
    expect(res.body.accountStatus).toBe('ACTIVE');
  });

  it('rejects suspending yourself', async () => {
    const admin = await createUser({ level: 'admin' });
    const res = await suspend(admin, admin._id.toString());
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('CANNOT_SUSPEND_SELF');
  });

  it('rejects suspending another privileged account', async () => {
    const admin = await createUser({ level: 'admin' });
    const otherAdmin = await createUser({ level: 'admin' });
    const res = await suspend(admin, otherAdmin._id.toString());
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('CANNOT_SUSPEND_PRIVILEGED');
  });

  it('404s for a nonexistent target user', async () => {
    const admin = await createUser({ level: 'admin' });
    const res = await suspend(admin, '6aa8ef4710b14724c1eafcdc');
    expect(res.status).toBe(404);
  });

  // The real point of suspension: it must take effect on the suspended
  // user's ALREADY-ISSUED, still-valid JWT immediately — not just block
  // their next login. This is the actual enforcement point (the shared JWT
  // passport strategy), exercised here by hitting any authenticated route
  // with a token minted before the suspension.
  it('immediately cuts off an already-issued JWT once the account is suspended', async () => {
    const admin = await createUser({ level: 'admin' });
    const target = await createUser();
    const targetToken = tokenFor(target);

    const before = await request(app).post('/api/rooms/list').set('Authorization', `Bearer ${targetToken}`).send({});
    expect(before.status).toBe(200);

    await suspend(admin, target._id.toString());

    const after = await request(app).post('/api/rooms/list').set('Authorization', `Bearer ${targetToken}`).send({});
    expect(after.status).toBe(401);
  });

  it('a fresh login is refused with 403 while suspended, and works again after reactivation', async () => {
    const admin = await createUser({ level: 'admin' });
    const target = await createUser({ username: 'suspendme', email: 'suspendme@example.com' });
    await suspend(admin, target._id.toString());

    const blockedLogin = await request(app)
      .post('/api/login')
      .field('email', 'suspendme@example.com')
      .field('password', 'password123');
    expect(blockedLogin.status).toBe(403);

    await suspend(admin, target._id.toString(), false);

    const allowedLogin = await request(app)
      .post('/api/login')
      .field('email', 'suspendme@example.com')
      .field('password', 'password123');
    expect(allowedLogin.status).toBe(200);
    expect(allowedLogin.body.token).toBeDefined();
  });
});
