const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const store = require('../src/store');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const ConversationSummary = require('../src/models/ConversationSummary');

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
  store.config.groqApiKey = null;
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

const seedMessages = async (roomId, authorId, count) => {
  const docs = Array.from({ length: count }, (_, i) => ({
    author: authorId, room: roomId, content: `message ${i}`, type: 'text',
  }));
  return Message.insertMany(docs);
};

const enableGroq = (mockText) => {
  store.config.aiProvider = 'groq';
  store.config.groqApiKey = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: mockText } }] }),
  });
};

describe('Zeph AI routes — disabled by default (AI_PROVIDER unset)', () => {
  it('POST /api/ai/summarize returns 503 AI_DISABLED when no provider is configured', async () => {
    const user = await createUser();
    const room = await Room.create({ people: [user._id], title: 'Room', isGroup: true });

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('AI_DISABLED');
  });

  it('POST /api/ai/translate returns 503 when no provider is configured', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });
    expect(res.status).toBe(503);
  });

  it('POST /api/ai/rewrite returns 503 when no provider is configured', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/rewrite')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello' });
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

describe('Zeph AI — eligibility gating (summary)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('rejects a DM summary below the 30-message minimum with INSUFFICIENT_CONTEXT', async () => {
    enableGroq('a summary');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 20);

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('INSUFFICIENT_CONTEXT');
  });

  it('generates a DM summary at exactly the 30-message minimum (no Redis/BullMQ -> synchronous path)', async () => {
    enableGroq('Alice and Bob discussed the project timeline.');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 30);

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('Alice and Bob discussed the project timeline.');
  });

  it('rejects a group summary at 40 messages (group needs 100, not the DM 30)', async () => {
    enableGroq('a summary');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: true });
    await seedMessages(room._id, user._id, 40);

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(422);
  });

  it('reuses a fresh cached summary instead of calling the provider again', async () => {
    enableGroq('first summary');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 30);

    const first = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });
    expect(first.body.summary).toBe('first summary');

    // Only 5 new messages since the summary — below the 25-message freshness
    // threshold, so the cached summary must be reused, not regenerated.
    await seedMessages(room._id, user._id, 5);
    global.fetch = async () => { throw new Error('provider should NOT be called for a fresh cached summary'); };

    const second = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.summary).toBe('first summary');
  });

  it('regenerates once the freshness threshold (25 new messages) is crossed', async () => {
    enableGroq('first summary');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 30);
    await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    await seedMessages(room._id, user._id, 25);
    enableGroq('updated summary');

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.summary).toBe('updated summary');
  });
});

describe('Zeph AI — authorization (cross-user access)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('blocks a non-member from summarizing a room they do not belong to', async () => {
    enableGroq('a summary');
    const member = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [member._id], isGroup: false });
    await seedMessages(room._id, member._id, 30);

    const res = await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(403);
  });

  it('blocks a non-member from requesting a draft reply for a room they do not belong to', async () => {
    enableGroq('a draft');
    const member = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [member._id], isGroup: false });
    await seedMessages(room._id, member._id, 5);

    const res = await request(app)
      .post('/api/ai/draft-reply')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(403);
  });
});

describe('Zeph AI — translate / rewrite (no room access required)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('translates client-supplied text without requiring room membership', async () => {
    enableGroq('bonjour');
    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });
    expect(res.status).toBe(200);
    expect(res.body.translation).toBe('bonjour');
  });

  it('rewrites client-supplied text', async () => {
    enableGroq('Hi there! Hope you are doing well.');
    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/rewrite')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hey whats up', tone: 'friendly' });
    expect(res.status).toBe(200);
    expect(res.body.rewritten).toBe('Hi there! Hope you are doing well.');
  });

  it('returns 502 when the provider request fails, instead of crashing', async () => {
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });

    expect(res.status).toBe(502);
  });
});

describe('Zeph AI — Phase 13 hardening: oversized input rejected before any processing', () => {
  it('rejects an oversized translate payload with 413, never calling the provider', async () => {
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => { throw new Error('provider must not be called for oversized input'); };

    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'x'.repeat(25000), targetLanguage: 'French' });

    expect(res.status).toBe(413);
    expect(res.body.reason).toBe('INPUT_TOO_LARGE');
  });

  it('rejects an oversized rewrite payload with 413, never calling the provider', async () => {
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => { throw new Error('provider must not be called for oversized input'); };

    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/rewrite')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'y'.repeat(25000) });

    expect(res.status).toBe(413);
    expect(res.body.reason).toBe('INPUT_TOO_LARGE');
  });
});

describe('Zeph AI — every response carries a requestId for cross-stage correlation (Phase 11)', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('includes requestId on a successful translate response', async () => {
    enableGroq('bonjour');
    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId.length).toBeGreaterThan(0);
  });

  it('includes requestId on a failed (502) translate response', async () => {
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });

    expect(typeof res.body.requestId).toBe('string');
  });
});

describe('Zeph AI — title / topics', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('rejects a title suggestion below the 5-message minimum', async () => {
    enableGroq('Project Kickoff');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 4);

    const res = await request(app)
      .post('/api/ai/title')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(422);
  });

  it('suggests a title once the 5-message minimum is met', async () => {
    enableGroq('Project Kickoff');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 5);

    const res = await request(app)
      .post('/api/ai/title')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Project Kickoff');
  });

  it('rejects topic extraction for a non-group room', async () => {
    enableGroq('topic list');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 60);

    const res = await request(app)
      .post('/api/ai/topics')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(400);
  });

  it('extracts topics for an eligible group', async () => {
    enableGroq('project timeline, budget, hiring');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: true });
    await seedMessages(room._id, user._id, 50);

    const res = await request(app)
      .post('/api/ai/topics')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual(['project timeline', 'budget', 'hiring']);
  });
});

describe('Zeph AI — output validation', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('fails safely (not 200, not a crash) when the provider returns empty output', async () => {
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => ({
      ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '   ' } }] }),
    });

    const user = await createUser();
    const res = await request(app)
      .post('/api/ai/translate')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ text: 'hello', targetLanguage: 'French' });

    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('INVALID_OUTPUT');
  });
});

describe('Zeph AI — persistence', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('persists the generated summary to ConversationSummary', async () => {
    enableGroq('a durable summary');
    const user = await createUser();
    const room = await Room.create({ people: [user._id], isGroup: false });
    await seedMessages(room._id, user._id, 30);

    await request(app)
      .post('/api/ai/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ roomID: room._id.toString() });

    const stored = await ConversationSummary.findOne({ room: room._id });
    expect(stored).not.toBeNull();
    expect(stored.summary).toBe('a durable summary');
    expect(stored.messageCountAtSummary).toBe(30);
  });
});
