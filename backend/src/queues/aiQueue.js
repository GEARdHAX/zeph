const { Queue } = require('bullmq');
const { getQueueConnection } = require('./connection');
const logger = require('../logger');

// Zeph AI — BullMQ AI Jobs (Phase 9). Same lazy-singleton pattern as
// securityAiQueue.js. Used for the one genuinely expensive/non-interactive
// operation Zeph AI has today — conversation summaries. Rewrite/translate/
// smart-reply stay synchronous (routes/ai/*.js) — they're single-message,
// bounded-context calls where a queue round-trip would add latency for no
// governance benefit (Phase 9 explicitly allows this).
const QUEUE_NAME = 'zeph-ai-summary';

let queue = null;
const getQueue = () => {
  const connection = getQueueConnection();
  if (!connection) return null;
  if (!queue) queue = new Queue(QUEUE_NAME, { connection });
  return queue;
};

// jobId = room:messageCountAtSummary boundary (Phase 8's dedupe key) — BullMQ
// refuses a second job with the same id while one is active/waiting, so N
// simultaneous requests for the same summary enqueue at most one job.
const enqueueSummaryJob = async ({
  roomId, conversationType, userId, messageCountAtSummary, requestId,
}) => {
  const q = getQueue();
  if (!q) return { enqueued: false };
  try {
    await q.add('generate-summary', {
      roomId, conversationType, userId, requestId,
    }, {
      jobId: `summary:${roomId}:${messageCountAtSummary}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
      timeout: 20000,
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
    });
    return { enqueued: true };
  } catch (err) {
    logger.warn({ err, roomId }, 'ai_summary_enqueue_failed');
    return { enqueued: false };
  }
};

module.exports = { QUEUE_NAME, getQueue, enqueueSummaryJob };
