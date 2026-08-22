const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const ConversationUserState = require('../src/models/ConversationUserState');

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
    level: 'standard',
    password,
  });
};

const send = (from, roomId, content) => request(app).post('/api/message')
  .set('Authorization', `Bearer ${tokenFor(from)}`)
  .send({ roomID: roomId, content, type: 'text' });

// message.js's ConversationUserState reappearance update is fire-and-forget
// (not awaited before the response is sent) — a tiny wait gives it time to
// land before asserting on the DB state.
const flush = () => new Promise((resolve) => { setTimeout(resolve, 50); });

describe('Delete DM lifecycle', () => {
  it('sets both deletedAt and deletedBefore on delete', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    const res = await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });
    expect(res.status).toBe(200);

    const state = await ConversationUserState.findOne({ conversation: room._id, user: a._id });
    expect(state.deletedAt).not.toBeNull();
    expect(state.deletedBefore).not.toBeNull();
  });

  it('a new message clears deletedAt but NOT deletedBefore', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });

    const beforeState = await ConversationUserState.findOne({ conversation: room._id, user: a._id });
    const originalDeletedBefore = beforeState.deletedBefore;

    await send(b, room._id.toString(), 'hi again');
    await flush();

    const afterState = await ConversationUserState.findOne({ conversation: room._id, user: a._id });
    expect(afterState.deletedAt).toBeNull();
    expect(afterState.deletedBefore.getTime()).toBe(originalDeletedBefore.getTime());
  });

  it('after delete + restore, the deleter only sees messages sent after the delete point', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await send(a, room._id.toString(), 'old message 1');
    await send(b, room._id.toString(), 'old message 2');

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });

    await send(b, room._id.toString(), 'new message after delete');

    const joinRes = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ id: room._id.toString() });
    expect(joinRes.status).toBe(200);
    const contents = joinRes.body.room.messages.map((m) => m.content);
    expect(contents).toEqual(['new message after delete']);
  });

  it('the OTHER participant (who never deleted) still sees full history', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await send(a, room._id.toString(), 'old message 1');

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });

    await send(b, room._id.toString(), 'new message after delete');

    const joinRes = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });
    const contents = joinRes.body.room.messages.map((m) => m.content);
    expect(contents).toEqual(['old message 1', 'new message after delete']);
  });

  it('more-messages.js and sync-messages.js also respect the deletedBefore cutoff for the deleter', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    const oldMsg = await send(a, room._id.toString(), 'old message');

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });

    const newMsgRes = await send(b, room._id.toString(), 'new message');
    const newMsgId = newMsgRes.body.message._id;

    const moreRes = await request(app).post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ roomID: room._id.toString(), firstMessageID: newMsgId });
    expect(moreRes.body.messages.find((m) => m.content === 'old message')).toBeUndefined();

    const syncRes = await request(app).post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ roomID: room._id.toString() });
    expect(syncRes.body.messages.map((m) => m.content)).toEqual(['new message']);
  });

  it('list-rooms.js excludes then re-includes the conversation around a delete->new-message cycle', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    await send(a, room._id.toString(), 'hi');

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });

    const excludedRes = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(excludedRes.body.rooms.find((r) => r._id === room._id.toString())).toBeUndefined();

    await send(b, room._id.toString(), 'new message');

    const includedRes = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(includedRes.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });

  it('a second delete after restore advances deletedBefore forward', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });
    const firstState = await ConversationUserState.findOne({ conversation: room._id, user: a._id });

    await send(b, room._id.toString(), 'restores it');
    await new Promise((resolve) => { setTimeout(resolve, 5); });

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ conversationId: room._id.toString() });
    const secondState = await ConversationUserState.findOne({ conversation: room._id, user: a._id });

    expect(secondState.deletedBefore.getTime()).toBeGreaterThan(firstState.deletedBefore.getTime());
  });
});
