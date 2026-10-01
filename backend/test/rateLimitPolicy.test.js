const store = require('../src/store');
const config = require('../config');
const { POLICIES, resolvePolicy, validateAllPolicies, perSecond, SECURITY_SENSITIVE } = require('../src/lib/rateLimitPolicy');

beforeEach(() => {
  store.config = config;
});

describe('rateLimitPolicy — resolves every named policy', () => {
  it.each(Object.keys(POLICIES))('resolves %s with a valid capacity and refillRate', (name) => {
    const { capacity, refillRate, failClosed } = resolvePolicy(name);
    expect(capacity).toBeGreaterThan(0);
    expect(refillRate).toBeGreaterThan(0);
    expect(typeof failClosed).toBe('boolean');
  });

  it('throws for an unknown policy name', () => {
    expect(() => resolvePolicy('NOT_A_REAL_POLICY')).toThrow('Unknown rate limit policy');
  });
});

describe('rateLimitPolicy — carried-over numeric values match the old limiters exactly', () => {
  // Each assertion documents the OLD (max, windowMs) this policy replaces —
  // see rateLimitPolicy.js's own per-entry comments for the migration
  // source (init.js's express-rate-limit instances / routes/index.js's
  // inviteRateLimit(...) calls).
  it.each([
    ['AUTH', 20, 15 * 60 * 1000],
    ['API', 300, 15 * 60 * 1000],
    ['AI', 15, 15 * 60 * 1000],
    ['DISCOVERY', 100, 15 * 60 * 1000],
    ['DELETE', 60, 15 * 60 * 1000],
    ['VAULT_UNLOCK', 8, 15 * 60 * 1000],
    ['INVITE_CREATE', 20, 60 * 60 * 1000],
    ['INVITE_PREVIEW', 30, 60 * 1000],
    ['INVITE_ACCEPT', 20, 60 * 1000],
    ['MEETING_INVITE_CREATE', 20, 60 * 60 * 1000],
    ['MEETING_INVITE_PREVIEW', 30, 60 * 1000],
    ['MEETING_INVITE_ACCEPT', 20, 60 * 1000],
    ['MESSAGE_SEND', 60, 60 * 1000],
    ['MESSAGE_SEARCH', 30, 60 * 1000],
    ['REPORT_CREATE', 10, 60 * 60 * 1000],
    ['PASSKEY_LOGIN', 20, 60 * 1000],
    ['SECURITY_AI_ANALYZE', 20, 60 * 1000],
  ])('%s: capacity=%d, refillRate matches old max/windowSeconds', (name, oldMax, oldWindowMs) => {
    const { capacity, refillRate } = resolvePolicy(name);
    expect(capacity).toBe(oldMax);
    expect(refillRate).toBeCloseTo(perSecond(oldMax, oldWindowMs), 10);
  });
});

describe('rateLimitPolicy — fail-closed set', () => {
  it('every security-sensitive policy named in the brief is in SECURITY_SENSITIVE', () => {
    ['AUTH', 'VAULT_UNLOCK', 'INVITE_ACCEPT', 'INVITE_CREATE', 'MEETING_INVITE_ACCEPT', 'MEETING_INVITE_CREATE', 'PASSKEY_LOGIN'].forEach(
      (name) => {
        expect(SECURITY_SENSITIVE.has(name)).toBe(true);
      },
    );
  });

  it('every policy in this implementation fails closed — a deliberate uniform choice, not per-category (see rateLimitPolicy.js comment)', () => {
    Object.keys(POLICIES).forEach((name) => {
      expect(resolvePolicy(name).failClosed).toBe(true);
    });
  });
});

describe('rateLimitPolicy — env var overrides', () => {
  const ORIGINAL_ENV = process.env.RATE_LIMIT_API_CAPACITY;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RATE_LIMIT_API_CAPACITY;
    else process.env.RATE_LIMIT_API_CAPACITY = ORIGINAL_ENV;
  });

  it('an env var override changes the resolved capacity', () => {
    process.env.RATE_LIMIT_API_CAPACITY = '999';
    expect(resolvePolicy('API').capacity).toBe(999);
  });

  it('an invalid (non-numeric) env var falls back to the default rather than producing NaN', () => {
    process.env.RATE_LIMIT_API_CAPACITY = 'not-a-number';
    expect(resolvePolicy('API').capacity).toBe(300);
  });

  it('a zero/negative env var override falls back to the default (startup validation would otherwise reject it)', () => {
    process.env.RATE_LIMIT_API_CAPACITY = '-5';
    expect(resolvePolicy('API').capacity).toBe(300);
  });
});

describe('validateAllPolicies', () => {
  it('does not throw against the real default policy table', () => {
    expect(() => validateAllPolicies()).not.toThrow();
  });
});
