const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');

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
    level: overrides.level || 'standard',
    password,
  });
};

describe('POST /api/room/create — DM idempotency and race safety', () => {
  it('two sequential calls for the same pair return the same room, not a duplicate', async () => {
    const me = await createUser();
    const other = await createUser();

    const res1 = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', other._id.toString());
    const res2 = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', other._id.toString());

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.room._id).toBe(res2.body.room._id);

    const rooms = await Room.find({ people: { $all: [me._id, other._id] }, isGroup: false });
    expect(rooms).toHaveLength(1);
  });

  it('reversed caller/counterpart order still converges on one room (canonical dmKey)', async () => {
    const a = await createUser();
    const b = await createUser();

    const resAB = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('counterpart', b._id.toString());
    const resBA = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .field('counterpart', a._id.toString());

    expect(resAB.body.room._id).toBe(resBA.body.room._id);
    const rooms = await Room.find({ people: { $all: [a._id, b._id] }, isGroup: false });
    expect(rooms).toHaveLength(1);
  });

  it('concurrent simultaneous requests for the same pair never create two rooms', async () => {
    const me = await createUser();
    const other = await createUser();

    const fire = () => request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', other._id.toString());

    const results = await Promise.all([fire(), fire(), fire(), fire(), fire()]);
    results.forEach((res) => expect(res.status).toBe(200));

    const roomIds = new Set(results.map((res) => res.body.room._id));
    expect(roomIds.size).toBe(1);

    const rooms = await Room.find({ people: { $all: [me._id, other._id] }, isGroup: false });
    expect(rooms).toHaveLength(1);
  });

  it('a different pair still gets its own separate room', async () => {
    const me = await createUser();
    const other1 = await createUser();
    const other2 = await createUser();

    const res1 = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', other1._id.toString());
    const res2 = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', other2._id.toString());

    expect(res1.body.room._id).not.toBe(res2.body.room._id);
  });
});
