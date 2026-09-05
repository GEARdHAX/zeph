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

module.exports = {
  logEligibilityRejected, logCacheHit, logQueued, resolveRequestId,
};
