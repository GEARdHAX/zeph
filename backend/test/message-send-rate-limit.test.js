require('dotenv').config();
const request = require('supertest');
const argon2 = require('argon2');
const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const { closeRateLimitConnection } = require('../src/lib/rateLimitClient');
const User = require('../src/models/User');
const Room = require('../src/models/Room');

let app;

// Phase 7 audit finding: /api/message previously had no dedicated rate
// limiter — only the generic apiLimiter fallback (300 req/15min, shared
// across every otherwise-unlimited /api route), far too loose a budget for
// spam-messaging abuse specifically.
//
// This limiter is now the distributed Redis token bucket (see
// docs/RATE-LIMITING.md). buildApp() (helpers/app.js) already configures
// rateLimitRedisUrl against the real test Redis by default — tests here
// just need REDIS_URL to actually be set (e.g. a CI environment without
// the secret would skip these, same `describeIfRedis` convention as
// groupCleanup.test.js/threatIntelSingleFlight.test.js).
const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await closeRateLimitConnection();
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

describeIfRedis('POST /api/message — rate limiting (real Redis token bucket)', () => {
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

    // A token bucket is NOT a fixed window (brief's own explicit warning:
    // "do not describe the new system as equivalent to a fixed-window
    // limiter") — MESSAGE_SEND's capacity is 60 with a 1/sec refill, so
    // across the real wall-clock time 61 sequential HTTP round trips take,
    // a token or two can legitimately regenerate mid-burst. The actual
    // guarantee a token bucket makes is "a burst is capped at capacity,
    // not unlimited" — asserted here as "at least one rejection occurs
    // somewhere in a 90-request burst," not "the 61st request specifically
    // fails," which would assume fixed-window semantics this system
    // deliberately does not have.
    let rejectedCount = 0;
    let rejectedBody;
    for (let i = 0; i < 90; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/message')
        .set('Authorization', `Bearer ${tokenFor(sender)}`)
        .send({ roomID: room._id.toString(), content: `spam ${i}`, type: 'text' });
      if (res.status === 429) {
        rejectedCount += 1;
        rejectedBody = res.body;
      }
    }
    expect(rejectedCount).toBeGreaterThan(0);
    // Brief's required 429 response shape — never Redis internals/token counts.
    expect(rejectedBody).toMatchObject({ status: 'error', code: 'RATE_LIMITED' });
    expect(typeof rejectedBody.retryAfter).toBe('number');
    expect(rejectedBody.retryAfter).toBeGreaterThan(0);
  }, 30000);

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

describe('POST /api/message — rate limiting, no Redis configured (fails closed)', () => {
  it('rejects every request with 429 rather than falling back to unlimited traffic', async () => {
    const original = store.config;
    // Both keys explicitly null — `config` (the imported module) already
    // resolved rateLimitRedisUrl from the real process.env.REDIS_URL at
    // import time, so a naive {...config, redisUrl: null} would still
    // carry that real value through and defeat this test.
    store.config = { ...config, redisUrl: null, rateLimitRedisUrl: null };
    const noRedisApp = buildApp();

    const sender = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [sender._id, other._id], title: 'Room', isGroup: true });

    const res = await request(noRedisApp)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(sender)}`)
      .send({ roomID: room._id.toString(), content: 'should be rejected', type: 'text' });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ status: 'error', code: 'RATE_LIMITED' });

    store.config = original;
  });
});
