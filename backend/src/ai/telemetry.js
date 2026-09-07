// Zeph AI — shared observability helpers (Phase 11). Every AI route logs
// through these so the event shape (field names, what's safe to include) is
// defined in exactly one place rather than re-invented per route. Never pass
// message/prompt/summary content into these — requestId + feature + reason
// + counts + durations only.
const crypto = require('crypto');
const logger = require('../logger');

// req.id comes from pino-http in production (index.js) but the lightweight
// test harness (test/helpers/app.js) never mounts it — every route falls
// back to a fresh uuid so requestId is always a real, present string on
// every response, in every environment, rather than sometimes undefined.
const resolveRequestId = (req) => req.id || crypto.randomUUID();

const logEligibilityRejected = ({
  requestId, feature, scope, reason, minMessages, count,
}) => {
  logger.info({
    requestId, feature, scope, reason, minMessages, count,
  }, 'ai_eligibility_rejected');
};

const logCacheHit = ({
  requestId, feature, scope, messageCountAtSummary, currentCount,
}) => {
  logger.info({
    requestId, feature, scope, messageCountAtSummary, currentCount,
  }, 'ai_cache_hit');
};

const logQueued = ({ requestId, feature, scope }) => {
  logger.info({ requestId, feature, scope }, 'ai_job_queued');
};

// Shared 4xx/5xx responder for a failed runGoverned() result. Every AI
// route had an identical block; this is the one place it lives now.
// - RATE_LIMITED / QUOTA_EXCEEDED  -> 429, with quota reset info so the
//   frontend can show a "come back in X" modal (retryAfter seconds, resetAt
//   ISO, quotaDetail identifying which limit).
// - GENERATION_IN_PROGRESS         -> 409 (a dedup collision, caller should
//   poll for the in-flight result).
// - everything else (provider down, invalid output) -> 502.
const REQUOTA_REASONS = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED']);
const aiFailureResponse = (res, result, requestIdFallback) => {
  const requestId = result.requestId || requestIdFallback;
  if (REQUOTA_REASONS.has(result.reason)) {
    return res.status(429).json({
      error: true,
      reason: result.reason,
      quotaDetail: result.quotaDetail,
      retryAfter: result.retryAfter,
      resetAt: result.resetAt,
      message: 'AI usage limit reached.',
      requestId,
    });
  }
  if (result.reason === 'GENERATION_IN_PROGRESS') {
    return res.status(409).json({
      error: true, reason: result.reason, message: 'This is already being generated — check back shortly.', requestId,
    });
  }
  return res.status(502).json({
    error: true, reason: result.reason, message: 'AI provider request failed.', requestId,
  });
};

module.exports = {
  logEligibilityRejected, logCacheHit, logQueued, resolveRequestId, aiFailureResponse,
};
