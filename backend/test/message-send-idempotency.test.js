const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const postSystemMessage = require('../src/utils/postSystemMessage');

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

// Phase 8 audit finding: retryWithBackoff (frontend) already re-POSTs
// /api/message on a lost response, and BottomBar.jsx already generates a
// clientID UUID for local optimistic-UI reconciliation — but never sent it
// to the server, so a retry after a successful-but-unacknowledged save
// created a real duplicate message. This suite proves the fix end-to-end,
// and separately proves the fix's own index doesn't regress every message
// that predates clientID (readBy/system messages/etc, which never set one).
describe('POST /api/message — idempotent retry via clientID', () => {
  it('a second POST with the same clientID returns the original message instead of creating a duplicate', async () => {
    const sender = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [sender._id, other._id], title: 'Room', isGroup: true });
    const clientID = 'retry-test-uuid-1';

    const first = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({
        roomID: room._id.toString(), content: 'hello', type: 'text', clientID,
      });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({
        roomID: room._id.toString(), content: 'hello', type: 'text', clientID,
      });
    expect(second.status).toBe(200);
    expect(second.body.message._id).toBe(first.body.message._id);

    const count = await Message.countDocuments({ room: room._id, clientID });
    expect(count).toBe(1);
  });

  it('two different clientIDs from the same sender in the same room both persist as separate messages', async () => {
    const sender = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [sender._id, other._id], title: 'Room', isGroup: true });

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({
        roomID: room._id.toString(), content: 'first', type: 'text', clientID: 'uuid-a',
      });
    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({
        roomID: room._id.toString(), content: 'second', type: 'text', clientID: 'uuid-b',
      });

    const count = await Message.countDocuments({ room: room._id, author: sender._id });
    expect(count).toBe(2);
  });

  it('messages sent without a clientID (legacy clients) are unaffected — multiple sends still all persist', async () => {
    const sender = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [sender._id, other._id], title: 'Room', isGroup: true });

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/message')
        .set('Authorization', `Bearer ${tokenFor(sender)}`)
        .send({ roomID: room._id.toString(), content: `no clientID ${i}`, type: 'text' });
      expect(res.status).toBe(200);
    }

    const count = await Message.countDocuments({ room: room._id, author: sender._id });
    expect(count).toBe(3);
  });

  // Regression test for the exact bug this fix introduced and then had to
  // correct: a naive `sparse: true` compound index on {room,author,clientID}
  // does NOT exclude a document unless EVERY indexed field is absent — a
  // system message (postSystemMessage.js) has no `author` at all, so two of
  // them in the same room would still collide on {author: null, clientID:
  // null} under sparse:true. The real fix is a partialFilterExpression that
  // only indexes rows with a genuine string clientID.
  it('multiple author-less system messages in the same room never collide on the idempotency index', async () => {
    const sender = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [sender._id, other._id], title: 'Room', isGroup: true });

    const m1 = await postSystemMessage(room._id, 'first system event', [sender._id, other._id]);
    const m2 = await postSystemMessage(room._id, 'second system event', [sender._id, other._id]);

    expect(m1).not.toBeNull();
    expect(m2).not.toBeNull();
    const count = await Message.countDocuments({ room: room._id, type: 'system' });
    expect(count).toBe(2);
  });
});
