const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const store = require('../src/store');
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
  store.config.aiProvider = 'none';
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

describe('AI routes — disabled by default (AI_PROVIDER unset)', () => {
  it('POST /api/ai/summarize returns 503 when no provider is configured', async () => {
    const user = await createUser();
    const room = await Room.create({ people: [user._id], title: 'Room', isGroup: true });

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(503);
  });

  it('POST /api/ai/translate returns 503 when no provider is configured', async () => {
    const user = await createUser();

    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });

    expect(res.status).toBe(503);
  });

  it('POST /api/ai/draft-reply returns 503 when no provider is configured', async () => {
    const user = await createUser();
    const room = await Room.create({ people: [user._id], title: 'Room', isGroup: true });

    const res = await request(app)
      .post('/api/ai/draft-reply')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(503);
  });
});

describe('AI routes — enabled (AI_PROVIDER=ollama, fetch mocked)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('summarizes a room, blocking non-members, using a mocked local provider response', async () => {
    store.config.aiProvider = 'ollama';
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ response: 'Alice and Bob discussed the project timeline.' }),
    });

    const member = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [member._id], title: 'Room', isGroup: true });
    await Message.create({ author: member._id, room: room._id, content: 'hello', type: 'text' });

    const blocked = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ roomID: room._id.toString() });
    expect(blocked.status).toBe(403);

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('Alice and Bob discussed the project timeline.');
  });

  it('translates client-supplied text without requiring room membership', async () => {
    store.config.aiProvider = 'ollama';
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ response: 'bonjour' }),
    });

    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });

    expect(res.status).toBe(200);
    expect(res.body.translation).toBe('bonjour');
  });

  it('returns 502 when the provider request fails, instead of crashing', async () => {
    store.config.aiProvider = 'ollama';
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });

    expect(res.status).toBe(502);
  });
});
