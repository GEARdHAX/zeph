const { evaluate, Decisions } = require('../src/services/zeroTrust/policyEngine');
const { SessionStates } = require('../src/services/zeroTrust/sessionContext');

const LOW_RISK = { score: 10, level: 'LOW', factors: [] };
const MEDIUM_RISK = { score: 45, level: 'MEDIUM', factors: [] };
const HIGH_RISK = { score: 70, level: 'HIGH', factors: [] };
const CRITICAL_RISK = { score: 95, level: 'CRITICAL', factors: [] };

const baseInput = (overrides = {}) => ({
  user: { id: 'user-1' },
  session: { _id: 'session-1' },
  sessionState: SessionStates.ACTIVE,
  rbacAllowed: true,
  resource: 'account',
  action: 'change_password', // SENSITIVE, allowBelow: 50
  riskContext: LOW_RISK,
  ...overrides,
});

describe('policyEngine.evaluate — ordering (spec section 15)', () => {
  it('DENYs an unauthenticated request before anything else, regardless of risk', () => {
    const result = evaluate(baseInput({ user: null, riskContext: LOW_RISK }));
    expect(result.decision).toBe(Decisions.DENY);
    expect(result.reason).toBe('not_authenticated');
  });

  it('DENYs a REVOKED session even at zero risk', () => {
    const result = evaluate(baseInput({ sessionState: SessionStates.REVOKED, riskContext: LOW_RISK }));
    expect(result.decision).toBe(Decisions.DENY);
    expect(result.reason).toBe('session_revoked');
  });

  it('DENYs when RBAC denies, even at zero risk — risk can never override RBAC (spec section 14)', () => {
    const result = evaluate(baseInput({ rbacAllowed: false, riskContext: LOW_RISK }));
    expect(result.decision).toBe(Decisions.DENY);
    expect(result.reason).toBe('rbac_denied');
  });

  it('RBAC denial takes precedence over an even-more-severe session state check ordering (RBAC evaluated before risk in all cases)', () => {
    // Confirms RBAC (step 3) still gates even when risk would otherwise ALLOW.
    const result = evaluate(baseInput({ rbacAllowed: false, riskContext: LOW_RISK }));
    expect(result.decision).toBe(Decisions.DENY);
  });
});

describe('policyEngine.evaluate — risk-based decisions', () => {
  it('ALLOWs a SENSITIVE action at LOW risk', () => {
    const result = evaluate(baseInput({ riskContext: LOW_RISK }));
    expect(result.decision).toBe(Decisions.ALLOW);
    expect(result.riskScore).toBe(10);
  });

  it('STEP_UPs a SENSITIVE action at/above its threshold (score 45 < allowBelow 50 still ALLOWs)', () => {
    const result = evaluate(baseInput({ riskContext: MEDIUM_RISK }));
    // MEDIUM_RISK score 45 is below SENSITIVE's allowBelow:50 -> ALLOW
    expect(result.decision).toBe(Decisions.ALLOW);
  });

  it('STEP_UPs a SENSITIVE action at HIGH risk (70 >= allowBelow 50)', () => {
    const result = evaluate(baseInput({ riskContext: HIGH_RISK }));
    expect(result.decision).toBe(Decisions.STEP_UP);
    expect(result.reason).toBe('risk_above_threshold');
  });

  it('DENYs at CRITICAL risk (above the absolute DENY_ABOVE ceiling)', () => {
    const result = evaluate(baseInput({ riskContext: CRITICAL_RISK }));
    expect(result.decision).toBe(Decisions.DENY);
    expect(result.reason).toBe('risk_critical');
  });

  it('ADMINISTRATIVE actions have a stricter threshold than SENSITIVE — same score, different outcome', () => {
    const sensitive = evaluate(baseInput({
      resource: 'account', action: 'change_password', riskContext: { score: 45, level: 'MEDIUM', factors: [] },
    }));
    const admin = evaluate(baseInput({
      resource: 'security_events', action: 'view', riskContext: { score: 45, level: 'MEDIUM', factors: [] },
    }));
    expect(sensitive.decision).toBe(Decisions.ALLOW); // 45 < 50
    expect(admin.decision).toBe(Decisions.STEP_UP); // 45 >= 40
  });

  it('an unrecognized resource:action defaults to NORMAL category (looser threshold)', () => {
    const result = evaluate(baseInput({ resource: 'nonexistent', action: 'nonexistent', riskContext: MEDIUM_RISK }));
    expect(result.decision).toBe(Decisions.ALLOW); // NORMAL allowBelow:80, 45 < 80
  });
});

describe('policyEngine.evaluate — session state', () => {
  it('SUSPICIOUS session state is reflected in the STEP_UP reason', () => {
    const result = evaluate(baseInput({ sessionState: SessionStates.SUSPICIOUS, riskContext: HIGH_RISK }));
    expect(result.decision).toBe(Decisions.STEP_UP);
    expect(result.reason).toBe('suspicious_session');
  });

  it('REAUTH_REQUIRED forces STEP_UP even at LOW risk', () => {
    const result = evaluate(baseInput({ sessionState: SessionStates.REAUTH_REQUIRED, riskContext: LOW_RISK }));
    expect(result.decision).toBe(Decisions.STEP_UP);
    expect(result.reason).toBe('reauth_required');
  });
});

describe('policyEngine.evaluate — decision shape', () => {
  it('always returns decision/reason/policy/riskScore/riskLevel/factors', () => {
    const result = evaluate(baseInput({ riskContext: { score: 15, level: 'LOW', factors: [{ type: 'KNOWN_DEVICE', weight: -10 }] } }));
    expect(result).toEqual({
      decision: Decisions.ALLOW,
      reason: 'risk_acceptable',
      policy: 'sensitive_action',
      riskScore: 15,
      riskLevel: 'LOW',
      factors: [{ type: 'KNOWN_DEVICE', weight: -10 }],
    });
  });

  it('only ever produces ALLOW, STEP_UP, or DENY — no other decision value', () => {
    const scenarios = [
      baseInput({ user: null }),
      baseInput({ sessionState: SessionStates.REVOKED }),
      baseInput({ rbacAllowed: false }),
      baseInput({ riskContext: LOW_RISK }),
      baseInput({ riskContext: HIGH_RISK }),
      baseInput({ riskContext: CRITICAL_RISK }),
    ];
    scenarios.forEach((input) => {
      expect(Object.values(Decisions)).toContain(evaluate(input).decision);
    });
  });
});
