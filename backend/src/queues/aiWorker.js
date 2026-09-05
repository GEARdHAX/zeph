const { Worker } = require('bullmq');
const logger = require('../logger');
const { getQueueConnection } = require('./connection');
const { QUEUE_NAME } = require('./aiQueue');
const { generateAndPersistSummary } = require('../ai/summaryService');
const Message = require('../models/Message');

// Zeph AI — BullMQ worker for summary generation (Phase 9, observability
// Phase 11). Mirrors securityAiWorker.js: a failed/unavailable AI result is
// NOT a job failure worth retrying with backoff (the gateway has already
// classified and logged the reason) — only an unexpected throw reaches
// BullMQ's own retry.
const processSummaryJob = async (job) => {
  const {
    roomId, userId, conversationType, requestId,
  } = job.data;
  // job.timestamp is set by BullMQ at enqueue time — the gap to "now" is
  // real queue wait time (Phase 11), distinct from provider latency
  // (measured separately inside runGoverned).
  const queueWaitMs = Date.now() - job.timestamp;
  const currentMessageCount = await Message.countDocuments({ room: roomId, type: 'text' });

  const result = await generateAndPersistSummary({
    roomId, userId, ip: 'queue', currentMessageCount, requestId, scope: conversationType,
  });

  if (!result.ok) {
    logger.info({
      requestId, roomId, reason: result.reason, queueWaitMs, attemptsMade: job.attemptsMade,
    }, 'ai_worker_summary_unavailable');
    return;
  }
  logger.info({
    requestId, roomId, queueWaitMs, attemptsMade: job.attemptsMade,
  }, 'ai_worker_summary_generated');
};

// concurrency:2 — same reasoning as securityAiWorker.js: the provider call
// is the bottleneck, not I/O; low concurrency avoids hammering Groq's free
// tier with parallel requests from one process.
const startAiWorker = () => {
  const connection = getQueueConnection();
  if (!connection) {
    logger.info('Zeph AI worker not started — Redis not configured');
    return null;
  }
  const worker = new Worker(QUEUE_NAME, processSummaryJob, { connection, concurrency: 2 });
  worker.on('failed', (job, err) => logger.error({
    err, requestId: job?.data?.requestId, roomId: job?.data?.roomId, attemptsMade: job?.attemptsMade,
  }, 'ai_worker_job_failed'));
  logger.info('Zeph AI worker started');
  return worker;
};

module.exports = { processSummaryJob, startAiWorker };
