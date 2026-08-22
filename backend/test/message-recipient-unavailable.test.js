const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');

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
    level: 'standard',
    accountStatus: overrides.accountStatus || 'ACTIVE',
    password,
  });
};

describe('Message send — recipient account status', () => {
  it('rejects sending to a room whose other participant has been hard-deleted', async () => {
    const sender = await createUser();
    const victim = await createUser();
    const room = await Room.create({ people: [sender._id, victim._id], isGroup: false });
    await User.deleteOne({ _id: victim._id });

    const res = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({ roomID: room._id.toString(), content: 'hi', type: 'text' });

    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('recipient_unavailable');
    const count = await Message.countDocuments({ room: room._id });
    expect(count).toBe(0);
  });

  it('rejects sending to a DEACTIVATED recipient with 403', async () => {
    const sender = await createUser();
    const recipient = await createUser({ accountStatus: 'DEACTIVATED' });
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });

    const res = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({ roomID: room._id.toString(), content: 'hi', type: 'text' });

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('recipient_unavailable');
    const count = await Message.countDocuments({ room: room._id });
    expect(count).toBe(0);
  });

  it('allows sending to a normal ACTIVE recipient (regression)', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], isGroup: false });

    const res = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({ roomID: room._id.toString(), content: 'hi', type: 'text' });

    expect(res.status).toBe(200);
  });
});
