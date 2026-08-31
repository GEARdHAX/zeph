const crypto = require('crypto');
const store = require('../../store');
const logger = require('../../logger');
const { getProvider } = require('../../ai/provider');
const { buildCircuitBreaker } = require('../threatIntel/circuitBreaker'); // reused as-is — a generic, provider-agnostic factory despite living in threatIntel/, see that file's own header
const { sanitizeContext } = require('./sanitizer');
const { buildPrompt } = require('./promptBuilder');
const { routeModel } = require('./modelRouter');
const { validateAnalysisOutput } = require('./schema');
const { getCachedAnalysis, setCachedAnalysis } = require('./cache');

// The AI Gateway (spec sections 18-19) — the ONLY place in ZEPH that calls
// the AI provider for security analysis. Controllers/queues call
// SecurityAiService.analyze(), never Ollama directly (spec section 18).
//
// Pipeline: sanitize -> route -> prompt -> provider (timeout + circuit
// breaker) -> validate -> cache. Every stage fails toward "no analysis,
// deterministic security continues" (spec sections 35/41), never toward a
// thrown error that could take down a caller.
const ANALYSIS_TYPES = new Set(['ANOMALY', 'RISK_EXPLANATION', 'INCIDENT_SUMMARY']);

// Only these tripping reasons open the breaker — a genuinely malformed
// model response is a data-quality problem, not provider unavailability,
// same distinction circuitBreaker.js's own TRIPPING_REASONS already draws
// for threat intel (timeout/network_error/server_error count; a bad
// answer doesn't).
const TRIPPING_REASONS = new Set(['timeout', 'network_error', 'server_error', 'provider_disabled']);

let breaker = null;
const getBreaker = () => {
  if (!breaker) breaker = buildCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 });
  return breaker;
};

// Test-only escape hatch — same pattern threatIntelService.js's own
// resetBreakerForTests() already establishes, so breaker state doesn't
// leak between unrelated test files sharing this module.
const resetBreakerForTests = () => { breaker = buildCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 }); };

const getSecurityEventService = () => require('../securityEventService'); // eslint-disable-line global-require — deferred, same circular-require avoidance every other Phase 3-5 integration point uses

// Emits AI_ANALYSIS_FAILED / AI_PROVIDER_UNAVAILABLE / AI_CIRCUIT_OPEN —
// deliberately NOT for every call (spec section 44: "do not emit events
// for every internal cache hit"), only for the failure modes worth an
// admin's attention.
const recordFailureEvent = (type, detail) => {
  try {
    getSecurityEventService().record({
      type,
      severity: 'low',
      target: { resource: 'security_ai', action: 'analyze' },
      result: 'failure',
      sourceSystem: 'security_ai',
      metadata: detail,
    });
  } catch (err) {
    logger.warn({ err }, 'security_ai_failure_event_record_failed');
  }
};

// Core entry point (spec section 19). context is the RAW feature vector
// (from featureExtraction.js or a caller-built equivalent) — sanitized
// HERE, not by the caller, so there is exactly one enforcement point no
// call site can accidentally bypass.
//
// scopeId (optional) — a caller-supplied identity string (e.g. a userId)
// mixed into the CACHE KEY only, never into the prompted context itself
// (see cache.js's own comment on the bug this fixes: two different
// users/hosts producing identical aggregate counts must never silently
// share one cached AI verdict).
const analyze = async ({ context, analysisType, scopeId }) => {
  if (!ANALYSIS_TYPES.has(analysisType)) {
    return { ok: false, reason: 'invalid_analysis_type' };
  }

  const config = store.config || {};
  if (config.aiProvider === 'none' || !config.aiProvider) {
    return { ok: false, reason: 'ai_disabled' }; // spec section 41 — never an error, just "no analysis available," same shape as any other skip below
  }

  const sanitized = sanitizeContext(context);
  if (!sanitized) {
    return { ok: false, reason: 'invalid_context' };
  }

  // Short-lived cache (spec section 20) — checked AFTER sanitization so
  // the cache key is always derived from the same normalized shape
  // regardless of what extra fields a caller's raw context happened to
  // include.
  const cached = await getCachedAnalysis(analysisType, sanitized, scopeId);
  if (cached) return { ok: true, result: cached, cached: true };

  const cb = getBreaker();
  if (!cb.canAttempt()) {
    recordFailureEvent('AI_CIRCUIT_OPEN', { analysisType });
    return { ok: false, reason: 'circuit_open' };
  }

  const provider = getProvider(config);
  if (!provider.enabled) {
    recordFailureEvent('AI_PROVIDER_UNAVAILABLE', { analysisType, reason: 'provider_disabled' });
    return { ok: false, reason: 'provider_disabled' };
  }

  const { model, tier } = routeModel(sanitized, config);
  const prompt = buildPrompt(analysisType, sanitized);
  const timeoutMs = config.securityAiTimeoutMs || 8000;

  const startedAt = Date.now();
  let rawResponse;
  try {
    rawResponse = await provider.generate(prompt, {
      model, format: 'json', signal: AbortSignal.timeout(timeoutMs),
    });
    cb.recordSuccess();
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    const reason = isTimeout ? 'timeout' : 'network_error';
    if (TRIPPING_REASONS.has(reason)) cb.recordFailure(reason);
    logger.warn({ err: err.message, analysisType, model }, 'security_ai_provider_call_failed');
    recordFailureEvent('AI_ANALYSIS_FAILED', { analysisType, reason });
    return { ok: false, reason };
  }
  const latencyMs = Date.now() - startedAt;

  let parsed;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (err) {
    logger.warn({ analysisType, model }, 'security_ai_response_not_json');
    recordFailureEvent('AI_ANALYSIS_FAILED', { analysisType, reason: 'malformed_json' });
    return { ok: false, reason: 'malformed_json' };
  }

  const validation = validateAnalysisOutput(parsed);
  if (!validation.ok) {
    logger.warn({ analysisType, model, reason: validation.reason }, 'security_ai_output_validation_failed');
    recordFailureEvent('AI_ANALYSIS_FAILED', { analysisType, reason: validation.reason });
    return { ok: false, reason: validation.reason };
  }

  const analysisId = crypto.randomUUID();
  const meta = {
    analysisId,
    model,
    modelTier: tier,
    promptVersion: 1,
    analysisType,
    latencyMs,
    createdAt: new Date().toISOString(),
  };
  const result = { ...validation.result, ...meta };

  const ttlSeconds = config.securityAiCacheTtlSeconds || 60;
  await setCachedAnalysis(analysisType, sanitized, result, ttlSeconds, scopeId);

  // AI_SECURITY_ANALYSIS for every completed analysis; AI_ANOMALY_DETECTED
  // ADDITIONALLY when the result says so — see securityEventTypes.js's own
  // comment on why these are two separate event types.
  try {
    getSecurityEventService().record({
      type: 'AI_SECURITY_ANALYSIS',
      severity: result.anomalous ? 'medium' : 'low',
      target: { resource: 'security_ai', action: analysisType.toLowerCase() },
      result: 'success',
      sourceSystem: 'security_ai',
      metadata: {
        analysisId,
        model,
        modelTier: tier,
        analysisType,
        confidence: result.confidence,
        category: result.category,
        anomalous: result.anomalous,
        inputContextHash: crypto.createHash('sha256').update(JSON.stringify(sanitized)).digest('hex'),
      },
    });
    if (result.anomalous) {
      getSecurityEventService().record({
        type: 'AI_ANOMALY_DETECTED',
        severity: result.confidence >= 70 ? 'high' : 'medium',
        target: { resource: 'security_ai', action: analysisType.toLowerCase() },
        result: 'success',
        sourceSystem: 'security_ai',
        metadata: {
          analysisId, confidence: result.confidence, category: result.category, signals: result.signals,
        },
      });
    }
  } catch (err) {
    logger.warn({ err }, 'security_ai_analysis_event_record_failed');
  }

  return { ok: true, result, cached: false };
};

module.exports = { analyze, resetBreakerForTests, breaker: { getState: () => getBreaker().getState() } };
