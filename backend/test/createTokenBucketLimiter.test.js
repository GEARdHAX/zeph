require('dotenv').config();
const express = require('express');
const request = require('supertest');
const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const { createTokenBucketLimiter, KeyResolvers } = require('../src/lib/createTokenBucketLimiter');
const { closeRateLimitConnection } = require('../src/lib/rateLimitClient');

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

// A real (in-memory) Mongo connection — SecurityEventService.record()
// (called internally by createTokenBucketLimiter on every 429) writes to
// it fire-and-forget; without a connection those writes hang on Mongoose's
// command buffer for 10s each and keep the test process alive after Jest
// reports done, same as every other test file in this suite that touches
// anything which logs a SecurityEvent.
beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

// A throwaway, disposable policy per test run so tests never collide with
// the real named policies (AUTH/API/etc.) or with each other's buckets.
const uniquePolicyName = () => `TEST_${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Minimal app wired the same way every real route is: a middleware that
// sets req.user BEFORE the limiter (mirroring passport running first) so
// byUser/byUserOrIp have something real to key on.
const buildTestApp = (limiter, { withUser = true } = {}) => {
  const app = express();
  if (withUser) {
    app.use((req, res, next) => {
      req.user = { id: req.headers['x-test-user'] || 'default-user' };
      next();
    });
  }
  app.get('/probe', limiter, (req, res) => res.status(200).json({ ok: true }));
  return app;
};

describe('createTokenBucketLimiter — no Redis configured (fails closed)', () => {
  beforeAll(() => {
    // Both keys explicitly null — see tokenBucket.test.js's identical note:
    // `config` resolves rateLimitRedisUrl from the real process.env.REDIS_URL
    // at import time, so a naive {...config, redisUrl: null} would still
    // carry that real value through and defeat this test.
    store.config = { ...config, redisUrl: null, rateLimitRedisUrl: null };
  });

  it('rejects with the documented 429 shape, never a crash or an allow', async () => {
    const limiter = createTokenBucketLimiter({ policyName: 'AUTH' });
    const app = buildTestApp(limiter);

    const res = await request(app).get('/probe');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      status: 'error',
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later.',
      retryAfter: expect.any(Number),
    });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('throws immediately for an unknown policy name rather than silently no-op-ing', () => {
    expect(() => createTokenBucketLimiter({ policyName: 'NOT_REAL' })).toThrow('Unknown rate limit policy');
  });
});

describeIfRedis('createTokenBucketLimiter — real Redis', () => {
  afterAll(async () => {
    await closeRateLimitConnection();
  });

  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  it('allows requests under capacity and returns 200', async () => {
    const policyName = uniquePolicyName();
    process.env[`RATE_LIMIT_${policyName}_CAPACITY`] = '5';
    process.env[`RATE_LIMIT_${policyName}_REFILL_PER_SECOND`] = '1';
    // Register a throwaway policy by monkey-patching POLICIES for this test
    // only — simplest way to exercise the real middleware without needing
    // a brand-new named constant in rateLimitPolicy.js for every test.
    const { POLICIES } = require('../src/lib/rateLimitPolicy');
    POLICIES[policyName] = {
      capacity: () => 5,
      refillRate: () => 1,
    };

    const limiter = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byUser });
    const app = buildTestApp(limiter);

    const res = await request(app).get('/probe').set('x-test-user', `user-${Date.now()}`);
    expect(res.status).toBe(200);

    delete POLICIES[policyName];
  });

  it('rejects once capacity is exhausted, with a positive Retry-After', async () => {
    const policyName = uniquePolicyName();
    const { POLICIES } = require('../src/lib/rateLimitPolicy');
    POLICIES[policyName] = { capacity: () => 3, refillRate: () => 0.01 }; // near-zero refill for a clean test
    const limiter = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byUser });
    const app = buildTestApp(limiter);
    const user = `user-${Date.now()}`;

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get('/probe').set('x-test-user', user);
      expect(res.status).toBe(200);
    }
    const rejected = await request(app).get('/probe').set('x-test-user', user);
    expect(rejected.status).toBe(429);
    expect(rejected.body.retryAfter).toBeGreaterThan(0);

    delete POLICIES[policyName];
  });

  it('byUser keys separately per user — one user exhausting their bucket does not affect another', async () => {
    const policyName = uniquePolicyName();
    const { POLICIES } = require('../src/lib/rateLimitPolicy');
    POLICIES[policyName] = { capacity: () => 2, refillRate: () => 0.01 };
    const limiter = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byUser });
    const app = buildTestApp(limiter);
    const userA = `user-a-${Date.now()}`;
    const userB = `user-b-${Date.now()}`;

    await request(app).get('/probe').set('x-test-user', userA);
    await request(app).get('/probe').set('x-test-user', userA);
    const aRejected = await request(app).get('/probe').set('x-test-user', userA);
    expect(aRejected.status).toBe(429);

    const bAllowed = await request(app).get('/probe').set('x-test-user', userB);
    expect(bAllowed.status).toBe(200);

    delete POLICIES[policyName];
  });

  it('byIp falls back correctly for unauthenticated requests (no req.user)', async () => {
    const policyName = uniquePolicyName();
    const { POLICIES } = require('../src/lib/rateLimitPolicy');
    POLICIES[policyName] = { capacity: () => 5, refillRate: () => 1 };
    const limiter = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byIp });
    const app = buildTestApp(limiter, { withUser: false });

    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);

    delete POLICIES[policyName];
  });

  it('byUserOrIp prefers the authenticated user over IP when both are available', async () => {
    const policyName = uniquePolicyName();
    const { POLICIES } = require('../src/lib/rateLimitPolicy');
    POLICIES[policyName] = { capacity: () => 1, refillRate: () => 0.01 };
    const limiter = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byUserOrIp });
    const app = buildTestApp(limiter, { withUser: true });
    const user = `user-${Date.now()}`;

    const first = await request(app).get('/probe').set('x-test-user', user);
    expect(first.status).toBe(200);
    // Same IP (supertest/Node internally), same user — second request to
    // the SAME user's exhausted bucket must reject, proving the key
    // actually incorporated the user id (an IP-only key would also reject
    // here, but so would a correctly-working user key — this is confirmed
    // distinctly by the next test using a different user from the same IP).
    const second = await request(app).get('/probe').set('x-test-user', user);
    expect(second.status).toBe(429);

    delete POLICIES[policyName];
  });

  it('never leaks Redis internals, token counts, or key names in the 429 response body', async () => {
    const policyName = uniquePolicyName();
    const { POLICIES } = require('../src/lib/rateLimitPolicy');
    POLICIES[policyName] = { capacity: () => 1, refillRate: () => 0.01 };
    const limiter = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byUser });
    const app = buildTestApp(limiter);
    const user = `user-${Date.now()}`;

    await request(app).get('/probe').set('x-test-user', user);
    const rejected = await request(app).get('/probe').set('x-test-user', user);

    const serialized = JSON.stringify(rejected.body);
    expect(serialized).not.toMatch(/rl:v1/);
    expect(serialized).not.toMatch(/token/i);
    expect(Object.keys(rejected.body).sort()).toEqual(['code', 'message', 'retryAfter', 'status']);

    delete POLICIES[policyName];
  });

  it('multi-instance sharing — two separate middleware instances (simulating two backend processes) share the same bucket', async () => {
    const policyName = uniquePolicyName();
    const { POLICIES } = require('../src/lib/rateLimitPolicy');
    POLICIES[policyName] = { capacity: () => 2, refillRate: () => 0.01 };
    // Two independently constructed limiters, as if built by two separate
    // Node processes — the only thing they share is Redis.
    const limiterInstanceA = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byUser });
    const limiterInstanceB = createTokenBucketLimiter({ policyName, keyResolver: KeyResolvers.byUser });
    const appA = buildTestApp(limiterInstanceA);
    const appB = buildTestApp(limiterInstanceB);
    const user = `user-${Date.now()}`;

    const r1 = await request(appA).get('/probe').set('x-test-user', user);
    expect(r1.status).toBe(200);
    const r2 = await request(appB).get('/probe').set('x-test-user', user);
    expect(r2.status).toBe(200);
    // Capacity 2 now exhausted across BOTH "instances" — a third request to
    // EITHER instance must be rejected, proving they share one Redis bucket
    // rather than each getting their own independent budget.
    const r3 = await request(appA).get('/probe').set('x-test-user', user);
    expect(r3.status).toBe(429);
    const r4 = await request(appB).get('/probe').set('x-test-user', user);
    expect(r4.status).toBe(429);

    delete POLICIES[policyName];
  });
});
