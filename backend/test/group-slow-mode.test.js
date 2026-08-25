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

const createGroup = (owner, memberIds = []) => request(app)
  .post('/api/group/create')
  .set('Authorization', `Bearer ${tokenFor(owner)}`)
  .send({ title: 'Test Group', people: memberIds.map((id) => id.toString()) });

const setSlowMode = (actor, groupId, slowModeSeconds) => request(app)
  .post('/api/group/update')
  .set('Authorization', `Bearer ${tokenFor(actor)}`)
  .send({ id: groupId, slowModeSeconds });

const send = (user, roomID, content) => request(app)
  .post('/api/message')
  .set('Authorization', `Bearer ${tokenFor(user)}`)
  .field('roomID', roomID)
  .field('content', content)
  .field('type', 'text');

describe('Slow mode', () => {
  it('rejects a rapid second send from a MEMBER within the window', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await setSlowMode(owner, group.body._id, 30);

    const first = await send(member, group.body._id, 'first');
    expect(first.status).toBe(200);

    const second = await send(member, group.body._id, 'second');
    expect(second.status).toBe(429);
    expect(second.body.reason).toBe('SLOW_MODE');
  });

  it('OWNER bypasses slow mode', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    await setSlowMode(owner, group.body._id, 30);

    const first = await send(owner, group.body._id, 'first');
    expect(first.status).toBe(200);
    const second = await send(owner, group.body._id, 'second');
    expect(second.status).toBe(200);
  });

  it('ADMIN bypasses slow mode', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const group = await createGroup(owner, [admin._id]);
    await request(app)
      .post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: admin._id, role: 'ADMIN' });
    await setSlowMode(owner, group.body._id, 30);

    const first = await send(admin, group.body._id, 'first');
    expect(first.status).toBe(200);
    const second = await send(admin, group.body._id, 'second');
    expect(second.status).toBe(200);
  });

  it('disabled (0) slow mode never blocks sends', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await setSlowMode(owner, group.body._id, 0);

    const first = await send(member, group.body._id, 'first');
    expect(first.status).toBe(200);
    const second = await send(member, group.body._id, 'second');
    expect(second.status).toBe(200);
  });

  it('unset slow mode (never configured) never blocks sends', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    const first = await send(member, group.body._id, 'first');
    expect(first.status).toBe(200);
    const second = await send(member, group.body._id, 'second');
    expect(second.status).toBe(200);
  });

  it('rejects an invalid slow-mode interval', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await setSlowMode(owner, group.body._id, 7);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('INVALID_SLOW_MODE');
  });
});
