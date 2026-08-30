const db = require('./helpers/db');
const SecurityEvent = require('../src/models/SecurityEvent');
const { computeRiskFactors, NEW_SESSION_THRESHOLD_MS } = require('../src/services/zeroTrust/riskEngine');

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const seedSecurityEvent = (overrides = {}) => SecurityEvent.create({
  eventId: `evt-${Math.random().toString(36).slice(2)}`,
  timestamp: overrides.timestamp || new Date(),
  type: overrides.type || 'LOGIN_FAILED',
  severity: overrides.severity || 'medium',
  actor: { userId: overrides.userId || 'user-1', sessionId: null },
  source: { ip: null, userAgent: null, deviceId: null },
  target: { resource: null, resourceId: null, action: null },
  result: overrides.result || 'failure',
  metadata: {},
});

describe('riskEngine.computeRiskFactors — device/session signal', () => {
  it('no session at all -> UNKNOWN_DEVICE, does not force any other state', async () => {
    const result = await computeRiskFactors({ userId: 'user-1', session: null });
    expect(result.factors).toEqual([{ type: 'UNKNOWN_DEVICE', weight: 20, reason: 'no_session_context' }]);
    expect(result.score).toBe(20);
    expect(result.level).toBe('LOW'); // 20 <= 30
  });

  it('a brand-new session -> NEW_SESSION + UNKNOWN_DEVICE (both apply)', async () => {
    const session = { createdAt: new Date(), revokedAt: null };
    const result = await computeRiskFactors({ userId: 'user-1', session });
    const types = result.factors.map((f) => f.type);
    expect(types).toContain('NEW_SESSION');
    expect(types).toContain('UNKNOWN_DEVICE');
    expect(result.score).toBe(30); // 10 + 20
  });

  it('an old (known) session -> KNOWN_DEVICE, lowers score', async () => {
    const session = { createdAt: new Date(Date.now() - NEW_SESSION_THRESHOLD_MS - 60000), revokedAt: null };
    const result = await computeRiskFactors({ userId: 'user-1', session });
    expect(result.factors).toEqual([{ type: 'KNOWN_DEVICE', weight: -10, sessionAgeMs: expect.any(Number) }]);
    expect(result.score).toBe(0); // clamped — can't go negative
  });

  it('a revoked session -> REVOKED_SESSION, forces score to the clamp ceiling', async () => {
    const session = { createdAt: new Date(Date.now() - 999999), revokedAt: new Date() };
    const result = await computeRiskFactors({ userId: 'user-1', session });
    expect(result.factors.some((f) => f.type === 'REVOKED_SESSION')).toBe(true);
    expect(result.score).toBe(100);
    expect(result.level).toBe('CRITICAL');
  });
});

describe('riskEngine.computeRiskFactors — behavioral signals (own SecurityEvent history)', () => {
  const knownSession = { createdAt: new Date(Date.now() - NEW_SESSION_THRESHOLD_MS - 60000), revokedAt: null };

  it('fewer than 3 recent failed logins does not add the factor', async () => {
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession });
    expect(result.factors.some((f) => f.type === 'RECENT_FAILED_LOGINS')).toBe(false);
  });

  it('3+ recent failed logins adds RECENT_FAILED_LOGINS', async () => {
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession });
    const factor = result.factors.find((f) => f.type === 'RECENT_FAILED_LOGINS');
    expect(factor).toBeDefined();
    expect(factor.count).toBe(3);
    expect(result.score).toBe(-10 + 25); // KNOWN_DEVICE + RECENT_FAILED_LOGINS, clamped to >= 0
  });

  it('a recent PERMISSION_DENIED event adds RECENT_PERMISSION_DENIED', async () => {
    await seedSecurityEvent({ userId: 'user-1', type: 'PERMISSION_DENIED' });
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession });
    expect(result.factors.some((f) => f.type === 'RECENT_PERMISSION_DENIED')).toBe(true);
  });

  it('a recent UNAUTHORIZED_ACCESS event also counts toward RECENT_PERMISSION_DENIED', async () => {
    await seedSecurityEvent({ userId: 'user-1', type: 'UNAUTHORIZED_ACCESS' });
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession });
    expect(result.factors.some((f) => f.type === 'RECENT_PERMISSION_DENIED')).toBe(true);
  });

  it('a recent RATE_LIMIT_TRIGGERED event adds its own factor', async () => {
    await seedSecurityEvent({ userId: 'user-1', type: 'RATE_LIMIT_TRIGGERED' });
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession });
    expect(result.factors.some((f) => f.type === 'RATE_LIMIT_TRIGGERED')).toBe(true);
  });

  it('events outside the lookback window are ignored', async () => {
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED', timestamp: new Date(Date.now() - 60 * 60 * 1000) });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED', timestamp: new Date(Date.now() - 60 * 60 * 1000) });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED', timestamp: new Date(Date.now() - 60 * 60 * 1000) });
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession });
    expect(result.factors.some((f) => f.type === 'RECENT_FAILED_LOGINS')).toBe(false);
  });

  it('never counts another user\'s SecurityEvents toward this user\'s risk', async () => {
    await seedSecurityEvent({ userId: 'user-2', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-2', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-2', type: 'LOGIN_FAILED' });
    const result = await computeRiskFactors({ userId: 'user-1', session: knownSession });
    expect(result.factors.some((f) => f.type === 'RECENT_FAILED_LOGINS')).toBe(false);
  });

  it('multiple simultaneous bad signals compound and can reach HIGH/CRITICAL', async () => {
    const newSession = { createdAt: new Date(), revokedAt: null }; // NEW_SESSION + UNKNOWN_DEVICE = 30
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' }); // +25
    await seedSecurityEvent({ userId: 'user-1', type: 'RATE_LIMIT_TRIGGERED' }); // +25
    const result = await computeRiskFactors({ userId: 'user-1', session: newSession });
    expect(result.score).toBe(30 + 25 + 25); // 80 — HIGH band is inclusive of 80 (riskWeights.js: {max:80, level:'HIGH'})
    expect(result.level).toBe('HIGH');
  });
});

describe('riskEngine — CRITICAL band', () => {
  it('a genuinely maxed-out combination lands in CRITICAL (score > 80)', async () => {
    const newSession = { createdAt: new Date(), revokedAt: null }; // 30
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' });
    await seedSecurityEvent({ userId: 'user-1', type: 'LOGIN_FAILED' }); // +25
    await seedSecurityEvent({ userId: 'user-1', type: 'RATE_LIMIT_TRIGGERED' }); // +25
    await seedSecurityEvent({ userId: 'user-1', type: 'PERMISSION_DENIED' }); // +15
    const result = await computeRiskFactors({ userId: 'user-1', session: newSession });
    expect(result.score).toBe(95); // 30 + 25 + 25 + 15
    expect(result.level).toBe('CRITICAL'); // > 80
  });
});

describe('riskEngine — score clamping and level bands', () => {
  it('never produces a score below 0', async () => {
    const veryOldSession = { createdAt: new Date(Date.now() - 999999999), revokedAt: null };
    const result = await computeRiskFactors({ userId: null, session: veryOldSession });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('never produces a score above 100', async () => {
    const session = { createdAt: new Date(), revokedAt: new Date() }; // REVOKED_SESSION alone is 100
    const result = await computeRiskFactors({ userId: 'user-1', session });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
