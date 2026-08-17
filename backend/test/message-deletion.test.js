const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const config = require('../config');

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
  });
};

describe('POST /api/message/delete — delete for me', () => {
  it('hides the message from the requesting user only', async () => {
    const author = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [author._id, other._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'hi', type: 'text' });

    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.deletedForEveryone).toBe(false);

    const stored = await Message.findById(message._id);
    expect(stored.deletedFor.map((id) => id.toString())).toContain(other._id.toString());
    expect(stored.content).toBe('hi'); // content untouched for everyone else
    expect(stored.deletedForEveryone).toBe(false);
  });

  it('any room member can delete-for-me, not just the author', async () => {
    const author = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [author._id, recipient._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'hi', type: 'text' });

    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(recipient)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString());

    expect(res.status).toBe(200);
  });

  it('is idempotent — deleting for me twice does not error or duplicate', async () => {
    const author = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'hi', type: 'text' });

    await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString());
    const second = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString());

    expect(second.status).toBe(200);
    const stored = await Message.findById(message._id);
    expect(stored.deletedFor).toHaveLength(1);
  });

  it('rejects a non-member of the room', async () => {
    const author = await createUser();
    const stranger = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'hi', type: 'text' });

    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString());

    expect(res.status).toBe(403);
  });
});

describe('POST /api/message/delete — delete for everyone', () => {
  it('the author can delete their own message for everyone, within the window', async () => {
    const author = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [author._id, other._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'oops', type: 'text' });

    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString())
      .field('forEveryone', 'true');

    expect(res.status).toBe(200);
    expect(res.body.deletedForEveryone).toBe(true);

    const stored = await Message.findById(message._id);
    expect(stored.deletedForEveryone).toBe(true);
    expect(stored.content).toBeNull();
    expect(stored.deletedAt).not.toBeNull();
  });

  it('rejects a non-author trying to delete for everyone (IDOR)', async () => {
    const author = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [author._id, other._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'hi', type: 'text' });

    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString())
      .field('forEveryone', 'true');

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('not_author');
    const stored = await Message.findById(message._id);
    expect(stored.deletedForEveryone).toBe(false);
    expect(stored.content).toBe('hi');
  });

  it('rejects deletion outside the configured deletion window', async () => {
    const author = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const oldDate = new Date(Date.now() - config.messageDeletionWindowMs - 60 * 1000);
    const message = await Message.create({
      room: room._id, author: author._id, content: 'old message', type: 'text', date: oldDate,
    });

    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString())
      .field('forEveryone', 'true');

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('deletion_window_expired');
    const stored = await Message.findById(message._id);
    expect(stored.deletedForEveryone).toBe(false);
  });

  it('is idempotent — deleting for everyone twice succeeds without changing deletedAt', async () => {
    const author = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'hi', type: 'text' });

    const first = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString())
      .field('forEveryone', 'true');
    const second = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString())
      .field('forEveryone', 'true');

    expect(second.status).toBe(200);
    expect(second.body.deletedAt).toBe(first.body.deletedAt);
  });

  it('rejects deleting a message in a room the user is not a member of', async () => {
    const author = await createUser();
    const stranger = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: author._id, content: 'hi', type: 'text' });

    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .field('roomID', room._id.toString())
      .field('messageID', message._id.toString())
      .field('forEveryone', 'true');

    expect(res.status).toBe(403);
  });

  it('returns 400 for a missing messageID', async () => {
    const author = await createUser();
    const res = await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', 'someroom');

    expect(res.status).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/message/delete').field('roomID', 'x').field('messageID', 'y');
    expect(res.status).toBe(401);
  });
});

describe('Tombstoned content is stripped from every message-listing route', () => {
  it('is hidden from GET-equivalent room join (POST /api/room/join)', async () => {
    const author = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const message = await Message.create({
      room: room._id, author: author._id, content: 'secret', type: 'text', deletedForEveryone: true, deletedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('id', room._id.toString());

    expect(res.status).toBe(200);
    const found = res.body.room.messages.find((m) => m._id === message._id.toString());
    expect(found).toBeDefined();
    expect(found.content).toBeNull();
  });

  it('is hidden from pagination (POST /api/messages/more)', async () => {
    const author = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const older = await Message.create({
      room: room._id, author: author._id, content: 'secret', type: 'text', deletedForEveryone: true, deletedAt: new Date(),
    });
    const newer = await Message.create({ room: room._id, author: author._id, content: 'newer', type: 'text' });

    const res = await request(app)
      .post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('firstMessageID', newer._id.toString());

    expect(res.status).toBe(200);
    const found = res.body.messages.find((m) => m._id === older._id.toString());
    expect(found.content).toBeNull();
  });

  it('is hidden from reconnect resync (POST /api/messages/sync)', async () => {
    const author = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });
    const message = await Message.create({
      room: room._id, author: author._id, content: 'secret', type: 'text', deletedForEveryone: true, deletedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString());

    expect(res.status).toBe(200);
    const found = res.body.messages.find((m) => m._id === message._id.toString());
    expect(found.content).toBeNull();
  });

  it('a "delete for me" message does not reappear on resync after reconnect', async () => {
    const author = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [author._id, other._id], isGroup: false });
    const message = await Message.create({
      room: room._id, author: author._id, content: 'hi', type: 'text', deletedFor: [other._id],
    });

    const res = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .field('roomID', room._id.toString());

    expect(res.status).toBe(200);
    const found = res.body.messages.find((m) => m._id === message._id.toString());
    expect(found).toBeUndefined();
  });

  it('a "delete for me" message does not reappear when paginating older history', async () => {
    const author = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [author._id, other._id], isGroup: false });
    const hidden = await Message.create({
      room: room._id, author: author._id, content: 'hi', type: 'text', deletedFor: [other._id],
    });
    const newer = await Message.create({ room: room._id, author: author._id, content: 'newer', type: 'text' });

    const res = await request(app)
      .post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .field('roomID', room._id.toString())
      .field('firstMessageID', newer._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.messages.find((m) => m._id === hidden._id.toString())).toBeUndefined();
  });

  it('a message deleted-for-me by user A still shows full content to user B', async () => {
    const author = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [author._id, other._id], isGroup: false });
    const message = await Message.create({
      room: room._id, author: author._id, content: 'still here', type: 'text', deletedFor: [author._id],
    });

    const res = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .field('roomID', room._id.toString());

    const found = res.body.messages.find((m) => m._id === message._id.toString());
    expect(found).toBeDefined();
    expect(found.content).toBe('still here');
  });
});

describe('Multi-device: message.js send emits, delete propagates via the same personal-room targeting', () => {
  it('a fresh POST /api/message still returns 200 and creates a normal, non-deleted message', async () => {
    // Regression check: the new schema fields/toJSON transform must not break the
    // ordinary, unrelated send path this feature deliberately does not touch.
    const author = await createUser();
    const room = await Room.create({ people: [author._id], isGroup: false });

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(author)}`)
      .field('roomID', room._id.toString())
      .field('content', 'hello')
      .field('type', 'text');

    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe('hello');
    expect(res.body.message.deletedForEveryone).toBe(false);
  });
});
