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

describe('POST /api/message/read', () => {
  it('marks a message as read and blocks non-members', async () => {
    const sender = await createUser();
    const reader = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [sender._id, reader._id], title: 'Room', isGroup: true });
    const message = await Message.create({ author: sender._id, room: room._id, content: 'hi', type: 'text' });

    const blocked = await request(app)
      .post('/api/message/read')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ roomID: room._id.toString(), messageID: message._id.toString() });
    expect(blocked.status).toBe(403);

    const res = await request(app)
      .post('/api/message/read')
      .set('Authorization', `Bearer ${tokenFor(reader)}`)
      .send({ roomID: room._id.toString(), messageID: message._id.toString() });

    expect(res.status).toBe(200);
    const updated = await Message.findById(message._id);
    expect(updated.readBy.map((id) => id.toString())).toContain(reader._id.toString());
  });

  it('is idempotent — marking read twice does not duplicate the readBy entry', async () => {
    const sender = await createUser();
    const reader = await createUser();
    const room = await Room.create({ people: [sender._id, reader._id], title: 'Room', isGroup: true });
    const message = await Message.create({ author: sender._id, room: room._id, content: 'hi', type: 'text' });

    await request(app)
      .post('/api/message/read')
      .set('Authorization', `Bearer ${tokenFor(reader)}`)
      .send({ roomID: room._id.toString(), messageID: message._id.toString() });
    await request(app)
      .post('/api/message/read')
      .set('Authorization', `Bearer ${tokenFor(reader)}`)
      .send({ roomID: room._id.toString(), messageID: message._id.toString() });

    const updated = await Message.findById(message._id);
    expect(updated.readBy.length).toBe(1);
  });
});

describe('POST /api/messages/sync', () => {
  it('returns only messages after lastMessageID, oldest first, and blocks non-members', async () => {
    const sender = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [sender._id, member._id], title: 'Room', isGroup: true });

    const m1 = await Message.create({ author: sender._id, room: room._id, content: 'one', type: 'text' });
    const m2 = await Message.create({ author: sender._id, room: room._id, content: 'two', type: 'text' });
    const m3 = await Message.create({ author: sender._id, room: room._id, content: 'three', type: 'text' });

    const blocked = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ roomID: room._id.toString(), lastMessageID: m1._id.toString() });
    expect(blocked.status).toBe(403);

    const res = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ roomID: room._id.toString(), lastMessageID: m1._id.toString() });

    expect(res.status).toBe(200);
    const contents = res.body.messages.map((m) => m.content);
    expect(contents).toEqual(['two', 'three']);
  });

  it('returns full room history when lastMessageID is omitted (first sync after login)', async () => {
    const sender = await createUser();
    const member = await createUser();
    const room = await Room.create({ people: [sender._id, member._id], title: 'Room', isGroup: true });
    await Message.create({ author: sender._id, room: room._id, content: 'only one', type: 'text' });

    const res = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBe(1);
  });
});
