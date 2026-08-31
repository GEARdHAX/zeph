require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const SecurityEvent = require('../src/models/SecurityEvent');
const { closeSecurityAiCacheConnection } = require('../src/services/securityAi/cache');
const { buildMockAiProvider } = require('../src/services/securityAi/mockAiProvider');

jest.mock('../src/ai/provider');
// eslint-disable-next-line import/order
const { getProvider } = require('../src/ai/provider');
// eslint-disable-next-line import/order
const securityAiService = require('../src/services/securityAi/securityAiService');

const flush = () => new Promise((resolve) => { setTimeout(resolve, 100); });

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
  await closeSecurityAiCacheConnection();
});

beforeEach(() => {
  store.config = {
    ...config, redisUrl: null, aiProvider: 'ollama', ollamaModel: 'llama3.2:1b', aiSecurityLargeModel: null, securityAiTimeoutMs: 8000, securityAiCacheTtlSeconds: 60,
  };
  securityAiService.resetBreakerForTests();
});

afterEach(async () => {
  await db.clearDatabase();
  jest.restoreAllMocks();
});

describe('securityAiService.analyze — happy path', () => {
  it('returns a validated result for a normal ANOMALY analysis', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({
      response: {
        anomalous: true, confidence: 82, category: 'authentication_behavior', signals: ['repeated_failed_login'], explanation: 'Multiple failed logins from a new device within the window.', recommendedAction: 'STEP_UP',
      },
    }));
    const result = await securityAiService.analyze({ context: { failedLoginCount: 5, newDevice: true }, analysisType: 'ANOMALY' });
    expect(result.ok).toBe(true);
    expect(result.result.anomalous).toBe(true);
    expect(result.result.confidence).toBe(82);
    expect(result.result.schemaVersion).toBe(1);
    expect(result.result.analysisId).toBeTruthy();
    expect(result.result.model).toBe('llama3.2:1b');
  });

  it('rejects an invalid analysisType before ever calling the provider', async () => {
    const mock = buildMockAiProvider();
    getProvider.mockReturnValue(mock);
    const result = await securityAiService.analyze({ context: {}, analysisType: 'NOT_A_TYPE' });
    expect(result).toEqual({ ok: false, reason: 'invalid_analysis_type' });
    expect(mock.callCount()).toBe(0);
  });

  it('returns ai_disabled without calling the provider when aiProvider is "none"', async () => {
    store.config.aiProvider = 'none';
    const mock = buildMockAiProvider();
    getProvider.mockReturnValue(mock);
    const result = await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    expect(result).toEqual({ ok: false, reason: 'ai_disabled' });
    expect(mock.callCount()).toBe(0);
  });

  it('persists an AI_SECURITY_ANALYSIS SecurityEvent for a completed analysis', async () => {
    getProvider.mockReturnValue(buildMockAiProvider());
    await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    await flush();
    const event = await SecurityEvent.findOne({ type: 'AI_SECURITY_ANALYSIS' });
    expect(event).toBeTruthy();
    expect(event.sourceSystem).toBe('security_ai');
  });

  it('ALSO persists AI_ANOMALY_DETECTED when the result says anomalous:true', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({
      response: {
        anomalous: true, confidence: 90, category: 'network_behavior', signals: ['malicious_ip'], explanation: 'Confirmed malicious destination correlated with a process anomaly.', recommendedAction: 'DENY',
      },
    }));
    await securityAiService.analyze({ context: { maliciousIpCount: 1 }, analysisType: 'ANOMALY' });
    await flush();
    const event = await SecurityEvent.findOne({ type: 'AI_ANOMALY_DETECTED' });
    expect(event).toBeTruthy();
  });

  it('does NOT persist AI_ANOMALY_DETECTED when the result says anomalous:false', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({
      response: {
        anomalous: false, confidence: 5, category: 'other', signals: [], explanation: 'Nothing unusual found.', recommendedAction: null,
      },
    }));
    await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    await flush();
    const event = await SecurityEvent.findOne({ type: 'AI_ANOMALY_DETECTED' });
    expect(event).toBeNull();
  });
});

describe('securityAiService.analyze — output validation / hallucination protection', () => {
  it('rejects malformed (non-JSON) output', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({ rawText: 'This looks malicious, trust me.' }));
    const result = await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    expect(result).toEqual({ ok: false, reason: 'malformed_json' });
  });

  it('rejects a JSON response missing required fields', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({ rawText: JSON.stringify({ confidence: 90 }) }));
    const result = await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    expect(result.ok).toBe(false);
  });

  it('never lets the model set riskScore/policyDecision/trusted, even when present in raw output', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({
      rawText: JSON.stringify({
        anomalous: false, confidence: 10, category: 'other', explanation: 'fine', riskScore: 0, policyDecision: 'ALLOW', trusted: true, allow: true,
      }),
    }));
    const result = await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.result)).not.toMatch(/policyDecision|trusted|riskScore/);
  });

  it('records AI_ANALYSIS_FAILED when output validation fails', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({ rawText: 'not json' }));
    await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    await flush();
    const event = await SecurityEvent.findOne({ type: 'AI_ANALYSIS_FAILED' });
    expect(event).toBeTruthy();
  });
});

describe('securityAiService.analyze — provider failure / circuit breaker (spec sections 35-37)', () => {
  it('a provider timeout returns a safe failure, never throws', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    getProvider.mockReturnValue(buildMockAiProvider({ failWith: err }));
    const result = await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('a disabled provider returns provider_disabled without throwing', async () => {
    getProvider.mockReturnValue({ enabled: false, generate: jest.fn() });
    const result = await securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' });
    expect(result).toEqual({ ok: false, reason: 'provider_disabled' });
  });

  it('opens the circuit after repeated provider failures and stops attempting calls', async () => {
    const mock = buildMockAiProvider({ failWith: new Error('network down') });
    getProvider.mockReturnValue(mock);
    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await securityAiService.analyze({ context: { failedLoginCount: i + 1 }, analysisType: 'ANOMALY' });
    }
    expect(securityAiService.breaker.getState()).toBe('OPEN');

    const callsBefore = mock.callCount();
    const result = await securityAiService.analyze({ context: { failedLoginCount: 99 }, analysisType: 'ANOMALY' });
    expect(result).toEqual({ ok: false, reason: 'circuit_open' });
    expect(mock.callCount()).toBe(callsBefore); // circuit open -> no new provider call attempted
  });

  it('security continues to function (returns a clean failure) when AI is completely unavailable — never throws or blocks the caller', async () => {
    getProvider.mockReturnValue(buildMockAiProvider({ failWith: new Error('ECONNREFUSED') }));
    await expect(securityAiService.analyze({ context: { failedLoginCount: 1 }, analysisType: 'ANOMALY' })).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
  });
});

describe('securityAiService.analyze — invalid context', () => {
  it('rejects a non-object context', async () => {
    getProvider.mockReturnValue(buildMockAiProvider());
    const result = await securityAiService.analyze({ context: null, analysisType: 'ANOMALY' });
    expect(result).toEqual({ ok: false, reason: 'invalid_context' });
  });
});
