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

// Phase 7 audit finding: /api/message previously had no dedicated rate
// limiter — only the generic apiLimiter fallback (300 req/15min, shared
// across every otherwise-unlimited /api route), far too loose a budget for
// spam-messaging abuse specifically.
describe('POST /api/message — rate limiting', () => {
  it('allows ordinary conversational-pace sending', async () => {
    const sender = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [sender._id, other._id], title: 'Room', isGroup: true });

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/message')
        .set('Authorization', `Bearer ${tokenFor(sender)}`)
        .send({ roomID: room._id.toString(), content: `message ${i}`, type: 'text' });
      expect(res.status).toBe(200);
    }
  });

  it('rate limits a burst past the per-minute budget', async () => {
    const sender = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [sender._id, other._id], title: 'Room', isGroup: true });

    let lastStatus;
    for (let i = 0; i < 61; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/message')
        .set('Authorization', `Bearer ${tokenFor(sender)}`)
        .send({ roomID: room._id.toString(), content: `spam ${i}`, type: 'text' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  }, 20000);

  it('rate limits are keyed per-user — one user hitting the limit does not block a different user', async () => {
    const spammer = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [spammer._id, other._id], title: 'Room', isGroup: true });

    for (let i = 0; i < 61; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/message')
        .set('Authorization', `Bearer ${tokenFor(spammer)}`)
        .send({ roomID: room._id.toString(), content: `spam ${i}`, type: 'text' });
    }

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .send({ roomID: room._id.toString(), content: 'hi, unrelated user', type: 'text' });
    expect(res.status).toBe(200);
  }, 20000);
});
