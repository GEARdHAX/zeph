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
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    level: overrides.level || 'standard',
    password,
  });
};

// Seeds `count` messages, oldest first, and returns them in that order.
const seedMessages = async (room, author, count) => {
  const docs = [];
  // eslint-disable-next-line no-await-in-loop
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    docs.push(await Message.create({ room: room._id, author: author._id, content: `msg-${i}`, type: 'text' }));
  }
  return docs;
};

describe('POST /api/messages/more — cursor pagination hasMore boundary', () => {
  it('returns hasMore:true and exactly 20 messages when more than 20 remain older than the cursor', async () => {
    const me = await createUser();
    const room = await Room.create({ people: [me._id], isGroup: false });
    const msgs = await seedMessages(room, me, 25);

    const res = await request(app)
      .post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('roomID', room._id.toString())
      .field('firstMessageID', msgs[msgs.length - 1]._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(20);
    expect(res.body.hasMore).toBe(true);
  });

  it('returns hasMore:false when exactly the page size or fewer remain', async () => {
    const me = await createUser();
    const room = await Room.create({ people: [me._id], isGroup: false });
    await seedMessages(room, me, 15);
    // Cursor after every seeded message — a fresh ObjectId minted "now" sorts
    // above all of them, unlike using the last seeded message's own _id
    // (which would exclude itself and only return 14).
    const cursor = await Message.create({ room: room._id, author: me._id, content: 'cursor', type: 'text' });

    const res = await request(app)
      .post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('roomID', room._id.toString())
      .field('firstMessageID', cursor._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(15);
    expect(res.body.hasMore).toBe(false);
  });

  it('returned messages are oldest-to-newest and strictly older than the cursor', async () => {
    const me = await createUser();
    const room = await Room.create({ people: [me._id], isGroup: false });
    const msgs = await seedMessages(room, me, 5);

    const res = await request(app)
      .post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('roomID', room._id.toString())
      .field('firstMessageID', msgs[4]._id.toString());

    const contents = res.body.messages.map((m) => m.content);
    expect(contents).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3']);
  });
});
