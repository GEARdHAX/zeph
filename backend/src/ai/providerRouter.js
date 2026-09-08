// Zeph AI — Provider Router (primary + automatic failover). Only the
// chat-assistant path (ai/gateway.js) uses this; securityAi and the
// route-level `.enabled` guards keep using getProvider() directly.
//
// AI_PROVIDER=gemini  -> primary Gemini, fallback Groq (if a Groq key is set)
// AI_PROVIDER=groq     -> primary Groq, no fallback (Groq is already the
//                         cheapest/simplest; nothing to fall back TO)
// AI_PROVIDER=ollama   -> primary Ollama, no fallback
//
// Failover fires ONLY on a provider-HEALTH failure — timeout, 5xx, 429,
// network error. A bad-output failure (empty text, malformed) is NOT a
// health problem and does not trigger a retry on the other provider (the
// same prompt would likely produce the same bad output; and the gateway's
// validateTextOutput handles it as INVALID_OUTPUT either way).
//
// Each provider has its own in-process circuit breaker (reusing
// threatIntel/circuitBreaker.js — a generic factory). When Gemini's breaker
// is OPEN, the router skips Gemini entirely and goes straight to Groq for
// the cooldown window, so a Gemini outage doesn't add a timeout's worth of
// latency to every single request.
const logger = require('../logger');
const { getProvider, buildGroqFallback } = require('./provider');
const { buildCircuitBreaker } = require('../services/threatIntel/circuitBreaker');

// One breaker per provider name, created lazily, module-level so state
// persists across requests in this process (same pattern as
// securityAiService.js's `breaker`).
const breakers = {};
const getBreaker = (name) => {
  if (!breakers[name]) {
    breakers[name] = buildCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 });
  }
  return breakers[name];
};

// Test-only — reset breaker state between unrelated test files.
const resetBreakersForTests = () => {
  Object.keys(breakers).forEach((k) => delete breakers[k]);
};

// Maps a thrown provider error to a circuitBreaker TRIPPING_REASON, or null
// if it's not a health failure (bad output, etc.) and shouldn't trip.
const healthFailureReason = (err) => {
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
  if (err.code === 'RATE_LIMITED') return 'rate_limited';
  if (err.code === 'SERVER_ERROR') return 'server_error';
  // A bare fetch network failure has no .code and no TimeoutError name.
  if (err.message && /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(err.message)) return 'network_error';
  return null;
};

// Returns { primary, fallback } — each is { name, provider } or null.
const resolveProviders = (config) => {
  const primaryName = config.aiProvider;
  const primary = getProvider(config);
  if (!primary.enabled) return { primary: null, fallback: null };

  let fallback = null;
  if (primaryName === 'gemini') {
    const groq = buildGroqFallback(config);
    if (groq) fallback = { name: 'groq', provider: groq };
  }
  return { primary: { name: primaryName, provider: primary }, fallback };
};

// generate(prompt, options) — same signature as a raw provider's generate,
// plus it returns { text, providerUsed } so the gateway can log which
// provider actually served the request. Throws only if BOTH providers fail
// (or the sole provider fails with no fallback available).
const generate = async (prompt, options = {}) => {
  const config = require('../store').config || {}; // eslint-disable-line global-require — avoids a load-order cycle with store
  const { primary, fallback } = resolveProviders(config);
  if (!primary) {
    const err = new Error('No AI provider is enabled');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const attempts = [primary, ...(fallback ? [fallback] : [])];
  let lastErr;

  for (let i = 0; i < attempts.length; i += 1) {
    const { name, provider } = attempts[i];
    const breaker = getBreaker(name);

    if (!breaker.canAttempt()) {
      logger.info({ provider: name }, 'ai_provider_circuit_open_skipping');
      lastErr = Object.assign(new Error(`${name} circuit open`), { code: 'PROVIDER_UNAVAILABLE' });
      continue; // eslint-disable-line no-continue
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const text = await provider.generate(prompt, options);
      breaker.recordSuccess();
      if (i > 0) logger.info({ provider: name, primaryProvider: primary.name }, 'ai_provider_fallback_used');
      return { text, providerUsed: name };
    } catch (err) {
      lastErr = err;
      const reason = healthFailureReason(err);
      if (reason) {
        breaker.recordFailure(reason);
        logger.warn({ provider: name, reason, err: err.message }, 'ai_provider_health_failure');
        // fall through to the next attempt (if any)
      } else {
        // Not a health failure (e.g. a 4xx that isn't 429) — don't retry the
        // other provider, the request itself is probably the problem.
        throw err;
      }
    }
  }

  throw lastErr;
};

// Whether ANY text provider is currently usable (circuit not open, at least
// one configured). ai/gateway.js uses this for its pre-flight "provider
// unavailable" check (accounts for a transiently-open circuit).
const anyProviderAvailable = (config) => {
  const { primary, fallback } = resolveProviders(config);
  if (!primary) return false;
  if (getBreaker(primary.name).canAttempt()) return true;
  if (fallback && getBreaker(fallback.name).canAttempt()) return true;
  return false;
};

// Whether Zeph AI text features are CONFIGURED (a usable primary OR a Groq
// fallback key). Routes use this for the pre-flight 503 guard — it does NOT
// consider circuit-breaker state (a transient Gemini outage shouldn't make
// the route pretend AI is turned off; the gateway will fail the individual
// request instead). Returns false only when AI_PROVIDER is none/unset or the
// selected provider has no key AND there's no Groq fallback key.
const aiTextEnabled = (config = {}) => {
  if (!config.aiProvider || config.aiProvider === 'none') return false;
  const { primary } = resolveProviders(config);
  if (primary) return true;
  // primary not enabled (no key) — is there a Groq fallback key at least?
  return config.aiProvider === 'gemini' && !!config.groqApiKey;
};

module.exports = {
  generate,
  anyProviderAvailable,
  aiTextEnabled,
  resetBreakersForTests,
  breakers,
};
