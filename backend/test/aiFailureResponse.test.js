const { aiFailureResponse } = require('../src/ai/telemetry');

// Minimal Express res stub.
const mockRes = () => {
  const r = { statusCode: null, body: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (payload) => { r.body = payload; return r; };
  return r;
};

describe('aiFailureResponse', () => {
  it('RATE_LIMITED -> 429 with retryAfter / resetAt / quotaDetail passed through', () => {
    const res = mockRes();
    aiFailureResponse(res, {
      ok: false,
      reason: 'RATE_LIMITED',
      quotaDetail: 'user_per_minute',
      retryAfter: 37,
      resetAt: '2026-01-01T00:00:37.000Z',
      requestId: 'r1',
    });
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      error: true,
      reason: 'RATE_LIMITED',
      quotaDetail: 'user_per_minute',
      retryAfter: 37,
      resetAt: '2026-01-01T00:00:37.000Z',
      requestId: 'r1',
    });
  });

  it('QUOTA_EXCEEDED -> 429', () => {
    const res = mockRes();
    aiFailureResponse(res, { ok: false, reason: 'QUOTA_EXCEEDED', retryAfter: 40000 });
    expect(res.statusCode).toBe(429);
    expect(res.body.reason).toBe('QUOTA_EXCEEDED');
  });

  it('GENERATION_IN_PROGRESS -> 409 (poll for the in-flight result)', () => {
    const res = mockRes();
    aiFailureResponse(res, { ok: false, reason: 'GENERATION_IN_PROGRESS', requestId: 'r2' });
    expect(res.statusCode).toBe(409);
    expect(res.body.reason).toBe('GENERATION_IN_PROGRESS');
  });

  it('PROVIDER_UNAVAILABLE and everything else -> 502', () => {
    const res = mockRes();
    aiFailureResponse(res, { ok: false, reason: 'PROVIDER_UNAVAILABLE' });
    expect(res.statusCode).toBe(502);
  });

  it('INVALID_OUTPUT -> 502', () => {
    const res = mockRes();
    aiFailureResponse(res, { ok: false, reason: 'INVALID_OUTPUT' });
    expect(res.statusCode).toBe(502);
  });

  it('uses the requestId fallback when the result has none', () => {
    const res = mockRes();
    aiFailureResponse(res, { ok: false, reason: 'PROVIDER_UNAVAILABLE' }, 'fallback-id');
    expect(res.body.requestId).toBe('fallback-id');
  });
});
