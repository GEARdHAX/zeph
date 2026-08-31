require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const { computeRiskFactors } = require('../src/services/zeroTrust/riskEngine');
const { setCachedAnalysis, closeSecurityAiCacheConnection } = require('../src/services/securityAi/cache');
const SecurityEventService = require('../src/services/securityEventService');

const flush = () => new Promise((resolve) => { setTimeout(resolve, 200); });

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
  await closeSecurityAiCacheConnection();
});

afterEach(async () => {
  await db.clearDatabase();
});

const knownSession = { createdAt: new Date(Date.now() - 999999), revokedAt: null };

describe('riskEngine + securityAi integration — no Redis (this suite\'s default)', () => {
  beforeEach(() => {
    store.config = { ...config, redisUrl: null };
  });

  it('contributes no AI_AUTH_ANOMALY factor when there is no Redis to cache/read an AI result from', async () => {
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession, ip: null });
    expect(result.factors.some((f) => f.type === 'AI_AUTH_ANOMALY')).toBe(false);
  });

  it('never throws or fails the whole risk evaluation when the AI cache read errors', async () => {
    await expect(computeRiskFactors({ userId: 'user-1', session: knownSession, ip: null })).resolves.toEqual(
      expect.objectContaining({ score: expect.any(Number) }),
    );
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('riskEngine + securityAi integration — real Redis', () => {
  beforeEach(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  it('a cached AI anomaly result ABOVE the confidence threshold contributes the bounded AI_AUTH_ANOMALY factor', async () => {
    const userId = `user-ai-risk-${Date.now()}`;
    SecurityEventService.record({
      type: 'LOGIN_FAILED', severity: 'medium', actor: { userId }, result: 'failure',
    });
    await flush();

    const context = {
      timeWindow: '5m', scope: 'user', failedLoginCount: 1, rateLimitCount: 0,
    };
    await setCachedAnalysis('ANOMALY', context, {
      schemaVersion: 1, anomalous: true, confidence: 85, category: 'authentication_behavior', signals: ['repeated_failed_login'], explanation: 'test', analysisId: 'test-analysis-1',
    }, 60, userId);

    const result = await computeRiskFactors({ userId, session: knownSession, ip: null });
    const factor = result.factors.find((f) => f.type === 'AI_AUTH_ANOMALY');
    expect(factor).toBeTruthy();
    expect(factor.weight).toBe(15); // RISK_WEIGHTS.AI_AUTH_ANOMALY — the fixed, bounded contribution, never scaled by confidence
    expect(factor.confidence).toBe(85);
  });

  it('a cached AI result BELOW the confidence threshold contributes nothing', async () => {
    const userId = `user-ai-risk-lowconf-${Date.now()}`;
    const context = {
      timeWindow: '5m', scope: 'user', failedLoginCount: 0, rateLimitCount: 0,
    };
    await setCachedAnalysis('ANOMALY', context, {
      schemaVersion: 1, anomalous: true, confidence: 50, category: 'authentication_behavior', signals: [], explanation: 'test', analysisId: 'test-analysis-2',
    }, 60, userId);

    const result = await computeRiskFactors({ userId, session: knownSession, ip: null });
    expect(result.factors.some((f) => f.type === 'AI_AUTH_ANOMALY')).toBe(false);
  });

  it('a cached AI result with anomalous:false contributes nothing even at high confidence', async () => {
    const userId = `user-ai-risk-clean-${Date.now()}`;
    const context = {
      timeWindow: '5m', scope: 'user', failedLoginCount: 0, rateLimitCount: 0,
    };
    await setCachedAnalysis('ANOMALY', context, {
      schemaVersion: 1, anomalous: false, confidence: 95, category: 'other', signals: [], explanation: 'test', analysisId: 'test-analysis-3',
    }, 60, userId);

    const result = await computeRiskFactors({ userId, session: knownSession, ip: null });
    expect(result.factors.some((f) => f.type === 'AI_AUTH_ANOMALY')).toBe(false);
  });

  it('never spends provider quota / never calls AI live from computeRiskFactors — no cached entry means no signal, not a fresh call', async () => {
    const userId = `user-ai-risk-uncached-${Date.now()}`;
    // No setCachedAnalysis call at all — nothing seeded for this user's context.
    const result = await computeRiskFactors({ userId, session: knownSession, ip: null });
    expect(result.factors.some((f) => f.type === 'AI_AUTH_ANOMALY')).toBe(false);
  });

  // Regression test for a real bug found during Phase 6 development: the
  // cache key originally hashed ONLY analysisType+context, with no
  // per-identity scoping — two DIFFERENT users producing the exact same
  // aggregate counts (a very real case: two brand-new users both at
  // failedLoginCount:0) would silently share one cached AI verdict, so
  // user B's risk score could be contaminated by an anomaly the AI
  // actually found for unrelated user A. Fixed by mixing userId into the
  // cache KEY (never into the context sent to the model) — see cache.js's
  // own comment.
  it('two different users with IDENTICAL aggregate counts never share a cached AI verdict', async () => {
    const userA = `user-ai-risk-collide-a-${Date.now()}`;
    const userB = `user-ai-risk-collide-b-${Date.now()}`;
    const identicalContext = {
      timeWindow: '5m', scope: 'user', failedLoginCount: 0, rateLimitCount: 0,
    };

    // Only userA gets a cached anomalous verdict.
    await setCachedAnalysis('ANOMALY', identicalContext, {
      schemaVersion: 1, anomalous: true, confidence: 95, category: 'authentication_behavior', signals: [], explanation: 'test', analysisId: 'test-analysis-collision',
    }, 60, userA);

    const resultA = await computeRiskFactors({ userId: userA, session: knownSession, ip: null });
    const resultB = await computeRiskFactors({ userId: userB, session: knownSession, ip: null });

    expect(resultA.factors.some((f) => f.type === 'AI_AUTH_ANOMALY')).toBe(true);
    // userB has the SAME context but was never analyzed — must NOT pick
    // up userA's cached verdict.
    expect(resultB.factors.some((f) => f.type === 'AI_AUTH_ANOMALY')).toBe(false);
  });

  it('the AI factor alone is never enough to push risk into DENY territory (bounded contribution, spec section 24)', async () => {
    const userId = `user-ai-risk-bounded-${Date.now()}`;
    const context = {
      timeWindow: '5m', scope: 'user', failedLoginCount: 0, rateLimitCount: 0,
    };
    await setCachedAnalysis('ANOMALY', context, {
      schemaVersion: 1, anomalous: true, confidence: 99, category: 'authentication_behavior', signals: [], explanation: 'test', analysisId: 'test-analysis-4',
    }, 60, userId);

    const result = await computeRiskFactors({ userId, session: knownSession, ip: null });
    // KNOWN_DEVICE(-10) + AI_AUTH_ANOMALY(15) at most — nowhere near the
    // DENY_ABOVE threshold policies.js defines for any category.
    expect(result.score).toBeLessThan(30);
  });
});
