require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const { consumeToken, validatePolicy, ttlFor } = require('../src/lib/tokenBucket');
const { closeRateLimitConnection } = require('../src/lib/rateLimitClient');

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

const uniqueIdentity = (label) => `test:${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

describe('tokenBucket — no Redis configured', () => {
  beforeAll(() => {
    // Both keys explicitly null — rateLimitClient.js reads rateLimitRedisUrl
    // (falling back to redisUrl), and `config` resolves that from the real
    // process.env.REDIS_URL at import time, so a naive {...config,
    // redisUrl: null} would still carry the real value through.
    store.config = { ...config, redisUrl: null, rateLimitRedisUrl: null };
  });

  it('reports redisAvailable: false and does not throw', async () => {
    const result = await consumeToken({ policyName: 'test', identity: 'u1', capacity: 10, refillRate: 1 });
    expect(result.allowed).toBe(false);
    expect(result.redisAvailable).toBe(false);
    expect(result.error).toBe('NO_REDIS_CONFIGURED');
  });
});

describe('validatePolicy — rejects malformed/malicious policy values', () => {
  it.each([
    [{ capacity: 0, refillRate: 1, cost: 1 }, 'zero capacity'],
    [{ capacity: -5, refillRate: 1, cost: 1 }, 'negative capacity'],
    [{ capacity: NaN, refillRate: 1, cost: 1 }, 'NaN capacity'],
    [{ capacity: Infinity, refillRate: 1, cost: 1 }, 'infinite capacity'],
    [{ capacity: 10, refillRate: 0, cost: 1 }, 'zero refill rate'],
    [{ capacity: 10, refillRate: -1, cost: 1 }, 'negative refill rate'],
    [{ capacity: 10, refillRate: NaN, cost: 1 }, 'NaN refill rate'],
    [{ capacity: 10, refillRate: 1, cost: 0 }, 'zero cost'],
    [{ capacity: 10, refillRate: 1, cost: -1 }, 'negative cost'],
    [{ capacity: 10, refillRate: 1, cost: 11 }, 'cost exceeding capacity (would never allow)'],
  ])('throws for %j (%s)', (policy) => {
    expect(() => validatePolicy(policy)).toThrow();
  });

  it('accepts a valid policy without throwing', () => {
    expect(() => validatePolicy({ capacity: 60, refillRate: 1, cost: 1 })).not.toThrow();
  });
});

describe('ttlFor — full refill time plus safety margin', () => {
  it('is longer than the time needed to fully refill from empty', () => {
    const capacity = 60;
    const refillRate = 1;
    const ttl = ttlFor(capacity, refillRate);
    expect(ttl).toBeGreaterThan(capacity / refillRate);
  });

  it('scales with capacity/refillRate, not a fixed arbitrary number', () => {
    const shortTtl = ttlFor(10, 1); // 10s to refill
    const longTtl = ttlFor(600, 1); // 600s to refill
    expect(longTtl).toBeGreaterThan(shortTtl);
  });
});

describeIfRedis('tokenBucket — real Redis (atomic consume)', () => {
  afterAll(async () => {
    await closeRateLimitConnection();
  });

  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  it('a fresh bucket starts full and the first request is allowed', async () => {
    const result = await consumeToken({
      policyName: 'test-fresh',
      identity: uniqueIdentity('fresh'),
      capacity: 10,
      refillRate: 1,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('allows a burst up to capacity, then rejects the next request', async () => {
    const identity = uniqueIdentity('burst');
    const policy = { policyName: 'test-burst', identity, capacity: 10, refillRate: 1 };

    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await consumeToken(policy);
      expect(result.allowed).toBe(true);
    }

    const eleventh = await consumeToken(policy);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tokens never exceed capacity even after a long idle period', async () => {
    const identity = uniqueIdentity('cap-ceiling');
    const policy = { policyName: 'test-ceiling', identity, capacity: 5, refillRate: 100 }; // fast refill
    await consumeToken(policy); // seed the bucket
    await new Promise((resolve) => setTimeout(resolve, 200)); // plenty of time to "overflow" at this refill rate
    const result = await consumeToken(policy);
    // 5 capacity, consumed 1 twice = at most 3 remaining, never more than capacity-1
    expect(result.remaining).toBeLessThanOrEqual(4);
  });

  it('tokens never go negative', async () => {
    const identity = uniqueIdentity('no-negative');
    const policy = { policyName: 'test-negative', identity, capacity: 3, refillRate: 1 };
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await consumeToken(policy);
    }
    const rejected = await consumeToken(policy);
    expect(rejected.allowed).toBe(false);
    // A denied request must not have deducted anything — remaining
    // reflects the refilled-but-insufficient amount, never negative.
    expect(rejected.remaining).toBeGreaterThanOrEqual(0);
  });

  it('refills over time — a request succeeds again after waiting long enough', async () => {
    const identity = uniqueIdentity('refill');
    const policy = { policyName: 'test-refill', identity, capacity: 1, refillRate: 5 }; // 1 token, refills in 200ms
    const first = await consumeToken(policy);
    expect(first.allowed).toBe(true);

    const immediateRetry = await consumeToken(policy);
    expect(immediateRetry.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterWait = await consumeToken(policy);
    expect(afterWait.allowed).toBe(true);
  });

  it('cost > 1 consumes the correct number of tokens', async () => {
    const identity = uniqueIdentity('cost');
    // refillRate 0.001/sec — effectively no refill across this test's real
    // wall-clock execution time, so remaining can be asserted precisely
    // instead of needing a floating-point tolerance for refill drift.
    const policy = { policyName: 'test-cost', identity, capacity: 10, refillRate: 0.001, cost: 5 };
    const first = await consumeToken(policy);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBeCloseTo(5, 1);

    const second = await consumeToken(policy);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBeCloseTo(0, 1);

    const third = await consumeToken(policy);
    expect(third.allowed).toBe(false);
  });

  it('different identities under the same policy have fully independent buckets', async () => {
    const policyName = 'test-isolation';
    const a = uniqueIdentity('a');
    const b = uniqueIdentity('b');

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await consumeToken({ policyName, identity: a, capacity: 5, refillRate: 1 });
    }
    const aExhausted = await consumeToken({ policyName, identity: a, capacity: 5, refillRate: 1 });
    expect(aExhausted.allowed).toBe(false);

    const bFresh = await consumeToken({ policyName, identity: b, capacity: 5, refillRate: 1 });
    expect(bFresh.allowed).toBe(true);
  });

  it('atomic concurrency — 30 simultaneous requests against capacity 10 allow at most 10', async () => {
    const identity = uniqueIdentity('concurrency');
    const policy = { policyName: 'test-concurrency', identity, capacity: 10, refillRate: 1 };

    const results = await Promise.all(Array.from({ length: 30 }, () => consumeToken(policy)));
    const allowedCount = results.filter((r) => r.allowed).length;

    // Not "exactly 10" — a little refill can happen across the real wall-
    // clock time 30 concurrent Redis round trips take — but nowhere near
    // all 30 succeeding, which is what GET-then-SET racing would produce
    // (the exact bug this atomic Lua script exists to prevent).
    expect(allowedCount).toBeGreaterThanOrEqual(10);
    expect(allowedCount).toBeLessThan(15);
  });

  it('an inactive bucket eventually expires from Redis (TTL)', async () => {
    const identity = uniqueIdentity('ttl');
    // capacity/refillRate chosen so ttlFor(...) is small enough to wait out in a test.
    const capacity = 2;
    const refillRate = 2; // full refill in 1s -> ttlFor = ceil(1) + 30 = 31s... too long for a unit test
    // Verify the TTL is actually SET on the key rather than waiting it out —
    // waiting out a real 30s+ TTL belongs in a manual/soak test, not CI.
    await consumeToken({ policyName: 'test-ttl', identity, capacity, refillRate });
    const { getClient } = require('../src/lib/rateLimitClient');
    const redis = getClient();
    const ttl = await redis.ttl(`rl:v1:test-ttl:${identity}`);
    expect(ttl).toBeGreaterThan(0);
  });
});
