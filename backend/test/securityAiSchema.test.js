const { validateAnalysisOutput, normalizeConfidence, SCHEMA_VERSION } = require('../src/services/securityAi/schema');

describe('normalizeConfidence', () => {
  it('upconverts a 0-1 float to 0-100', () => {
    expect(normalizeConfidence(0.82)).toBe(82);
  });

  it('passes through an already-0-100 value', () => {
    expect(normalizeConfidence(82)).toBe(82);
  });

  it('clamps above 100', () => {
    expect(normalizeConfidence(150)).toBe(100);
  });

  it('clamps below 0', () => {
    expect(normalizeConfidence(-10)).toBe(0);
  });

  it('returns null for a non-numeric value', () => {
    expect(normalizeConfidence('high')).toBeNull();
    expect(normalizeConfidence(NaN)).toBeNull();
    expect(normalizeConfidence(undefined)).toBeNull();
  });
});

describe('validateAnalysisOutput', () => {
  const valid = () => ({
    anomalous: true, confidence: 82, category: 'network_behavior', signals: ['malicious_ip'], explanation: 'Elevated risk due to a confirmed malicious destination.', recommendedAction: 'STEP_UP',
  });

  it('accepts a well-formed response', () => {
    const result = validateAnalysisOutput(valid());
    expect(result.ok).toBe(true);
    expect(result.result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.result.confidence).toBe(82);
  });

  it('rejects a non-object', () => {
    expect(validateAnalysisOutput(null)).toEqual({ ok: false, reason: 'not_an_object' });
    expect(validateAnalysisOutput('nope')).toEqual({ ok: false, reason: 'not_an_object' });
  });

  it('rejects a missing/non-boolean anomalous field', () => {
    const raw = { ...valid(), anomalous: 'yes' };
    expect(validateAnalysisOutput(raw)).toEqual({ ok: false, reason: 'missing_anomalous' });
  });

  it('rejects an invalid confidence', () => {
    const raw = { ...valid(), confidence: 'very high' };
    expect(validateAnalysisOutput(raw)).toEqual({ ok: false, reason: 'invalid_confidence' });
  });

  it('rejects a missing explanation', () => {
    const raw = { ...valid(), explanation: '' };
    expect(validateAnalysisOutput(raw).ok).toBe(false);
  });

  it('falls back category to "other" for an unrecognized value, rather than rejecting', () => {
    const raw = { ...valid(), category: 'made_up_category' };
    expect(validateAnalysisOutput(raw).result.category).toBe('other');
  });

  it('falls back recommendedAction to null for an unrecognized value', () => {
    const raw = { ...valid(), recommendedAction: 'BLOCK_USER' };
    expect(validateAnalysisOutput(raw).result.recommendedAction).toBeNull();
  });

  it('never surfaces riskScore/policyDecision/adminRole/trusted/allow even if the model returns them', () => {
    const raw = {
      ...valid(), riskScore: 100, policyDecision: 'DENY', adminRole: 'root', trusted: true, allow: true,
    };
    const result = validateAnalysisOutput(raw);
    expect(result.result.riskScore).toBeUndefined();
    expect(result.result.policyDecision).toBeUndefined();
    expect(result.result.adminRole).toBeUndefined();
    expect(result.result.trusted).toBeUndefined();
    expect(result.result.allow).toBeUndefined();
    expect(JSON.stringify(result.result)).not.toMatch(/policyDecision|adminRole/);
  });

  it('truncates an oversized signals array to 20 entries', () => {
    const raw = { ...valid(), signals: Array.from({ length: 50 }, (_, i) => `signal_${i}`) };
    expect(validateAnalysisOutput(raw).result.signals).toHaveLength(20);
  });

  it('truncates an oversized explanation rather than rejecting outright', () => {
    const raw = { ...valid(), explanation: 'x'.repeat(2000) };
    const result = validateAnalysisOutput(raw);
    expect(result.ok).toBe(true);
    expect(result.result.explanation).toHaveLength(1000);
  });
});
