// Zeph AI — AI API Gateway (Phase 3, observability added Phase 11, hardened
// Phase 13). The single place that calls the provider. routes/ai/*.js handle
// HTTP concerns (auth via passport middleware, param parsing, room-membership
// authorization) and then call into here; here handles governance: quota ->
// context budget -> dedup -> provider (with timeout) -> output validation ->
// cache/persist -> metrics.
//
// Mirrors services/securityAi/securityAiService.js's pipeline shape
// deliberately (sanitize -> route -> provider -> validate -> cache) rather
// than inventing a second convention for the same kind of problem.
const crypto = require('crypto');
const store = require('../store');
const logger = require('../logger');
const { getProvider } = require('./provider');
const {
  checkQuota, recordUsage, acquireConcurrency, releaseConcurrency,
} = require('./quota');
const { acquireLock, releaseLock } = require('./dedup');
const { validateTextOutput } = require('./outputValidation');
const { REJECTION_REASONS } = require('./policy');
const { estimateTokens } = require('./contextBuilder');

const PROVIDER_TIMEOUT_MS = () => store.config?.aiProviderTimeoutMs || 15000;

// One structured log line per governed call, win or lose (Phase 11) — every
// field here is either an id, an enum/reason, a count, or a duration; never
// prompt/output text (Phase 11: "never log message content, prompts
// containing private conversation data"). scope is a caller-supplied
// non-identifying label (e.g. "group"/"dm") — never a raw roomId/userId
// beyond what's already logged separately as requestId-linked fields.
const logOutcome = (event, fields) => {
  const { level = 'info', ...rest } = fields;
  logger[level](rest, event);
};

// Runs one governed AI generation. `dedupeKey` is optional — routes that
// operate on caller-supplied text with no shared, cacheable identity
// (translate, rewrite) omit it and skip locking entirely; routes keyed on a
// conversation (summary, title, topics) pass one so concurrent identical
// requests collapse into a single provider call (Phase 8).
//
// requestId (optional, Phase 11) — the caller (routes/ai/*.js) can pass an
// upstream correlation id (e.g. from pino-http's req.id) so every log line
// for one HTTP request, across every stage, shares one id; a fresh uuid is
// generated here if the caller doesn't have one (e.g. the BullMQ worker).
const runGoverned = async ({
  userId, ip, prompt, dedupeKey, maxTokens, metricsFeature, requestId, scope,
}) => {
  const config = store.config || {};
  const rid = requestId || crypto.randomUUID();
  const inputTokenEstimate = estimateTokens(prompt);
  const startedAt = Date.now();
  const base = {
    requestId: rid, feature: metricsFeature, scope, inputTokenEstimate,
  };

  if (config.aiProvider === 'none' || !config.aiProvider) {
    logOutcome('ai_request_rejected', { ...base, reason: REJECTION_REASONS.AI_DISABLED });
    return { ok: false, reason: REJECTION_REASONS.AI_DISABLED, requestId: rid };
  }

  const provider = getProvider(config);
  if (!provider.enabled) {
    logOutcome('ai_request_rejected', { ...base, reason: REJECTION_REASONS.PROVIDER_UNAVAILABLE });
    return { ok: false, reason: REJECTION_REASONS.PROVIDER_UNAVAILABLE, requestId: rid };
  }

  const quota = await checkQuota({ userId, ip, config });
  if (!quota.allowed) {
    logOutcome('ai_quota_rejected', {
      ...base, reason: quota.reason, detail: quota.detail,
    });
    return { ok: false, reason: quota.reason, requestId: rid };
  }

  let lock = { acquired: true, token: null };
  if (dedupeKey) {
    lock = await acquireLock(dedupeKey);
    if (!lock.acquired) {
      // Someone else is already generating the same thing — Phase 8's
      // "GOOD" path expects the caller to serve a cached/persisted result
      // instead; the gateway itself has no result to hand back here.
      logOutcome('ai_dedup_in_progress', base);
      return { ok: false, reason: 'GENERATION_IN_PROGRESS', requestId: rid };
    }
  }

  const queueWaitMs = Date.now() - startedAt; // everything above (quota GETs, lock acquire) counted as "wait" ahead of the actual provider call — meaningful once BullMQ job-pickup delay is added by the worker's own enqueuedAt timestamp (see queues/aiWorker.js)
  await acquireConcurrency(userId);
  const providerStartedAt = Date.now();
  try {
    let rawOutput;
    try {
      rawOutput = await provider.generate(prompt, {
        maxTokens,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS()),
      });
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      const reason = err.code === 'RATE_LIMITED' ? REJECTION_REASONS.RATE_LIMITED : REJECTION_REASONS.PROVIDER_UNAVAILABLE;
      const providerLatencyMs = Date.now() - providerStartedAt;
      logOutcome('ai_provider_call_failed', {
        ...base,
        level: 'warn',
        reason,
        isTimeout,
        providerLatencyMs,
        errMessage: err.message,
      });
      // Not recording usage — a failed provider call must never consume the
      // user's minute/day quota (Phase 13).
      return {
        ok: false, reason, requestId: rid, providerLatencyMs,
      };
    }
    const providerLatencyMs = Date.now() - providerStartedAt;

    const validation = validateTextOutput(rawOutput);
    if (!validation.ok) {
      logOutcome('ai_output_validation_failed', {
        ...base, level: 'warn', reason: validation.reason, providerLatencyMs,
      });
      // A malformed response is still a failed attempt from the user's
      // perspective — no usage recorded (Phase 13).
      return {
        ok: false, reason: 'INVALID_OUTPUT', requestId: rid, providerLatencyMs,
      };
    }

    await recordUsage({ userId, ip }); // ONLY successful calls spend quota (Phase 13)

    const totalLatencyMs = Date.now() - startedAt;
    const outputTokenEstimate = estimateTokens(validation.text);
    logOutcome('ai_request_succeeded', {
      ...base,
      queueWaitMs,
      providerLatencyMs,
      totalLatencyMs,
      outputTokenEstimate,
    });

    return {
      ok: true,
      text: validation.text,
      requestId: rid,
      providerLatencyMs,
      totalLatencyMs,
    };
  } finally {
    await releaseConcurrency(userId);
    if (dedupeKey) await releaseLock(dedupeKey, lock.token);
  }
};

module.exports = { runGoverned };
