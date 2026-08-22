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
    firstName: 'Test',
    lastName: 'User',
    level: overrides.level || 'standard',
    accountStatus: overrides.accountStatus || 'ACTIVE',
    password,
  });
};
const createAdmin = (overrides = {}) => createUser({ ...overrides, level: 'root' });

const call = (from, roomId, meetingId = 'm1') => request(app).post('/api/meeting/call')
  .set('Authorization', `Bearer ${tokenFor(from)}`)
  .send({ roomID: roomId, meetingID: meetingId });

describe('Call authorization (meeting/call.js)', () => {
  it('rejects calling into a room whose other participant has been hard-deleted', async () => {
    const caller = await createUser();
    const victim = await createUser();
    const room = await Room.create({ people: [caller._id, victim._id], isGroup: false });
    await User.deleteOne({ _id: victim._id });

    const res = await call(caller, room._id.toString());
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('recipient_unavailable');
  });

  it('rejects calling a DEACTIVATED recipient with 403', async () => {
    const caller = await createUser();
    const recipient = await createUser({ accountStatus: 'DEACTIVATED' });
    const room = await Room.create({ people: [caller._id, recipient._id], isGroup: false });

    const res = await call(caller, room._id.toString());
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('recipient_unavailable');
  });

  it('rejects calling a blocked relationship with 403 blocked', async () => {
    const caller = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [caller._id, recipient._id], isGroup: false });
    await request(app).post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(recipient)}`)
      .send({ username: caller.username });

    const res = await call(caller, room._id.toString());
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('blocked');
  });

  it('rejects a standard caller calling a privileged account with a generic 404 (admin boundary, no reason leaked)', async () => {
    const caller = await createUser();
    const admin = await createAdmin();
    const room = await Room.create({ people: [caller._id, admin._id], isGroup: false });

    const res = await call(caller, room._id.toString());
    expect(res.status).toBe(404);
    expect(res.body.reason).toBeUndefined();
  });

  it('allows a normal call between two active, unblocked, non-privileged users (regression)', async () => {
    const caller = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [caller._id, recipient._id], isGroup: false });

    const res = await call(caller, room._id.toString());
    expect(res.status).toBe(200);
  });
});
