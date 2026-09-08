const { Worker } = require('bullmq');
const logger = require('../logger');
const { getQueueConnection } = require('./connection');
const { QUEUE_NAME } = require('./aiQueue');
const { generateAndPersistSummary } = require('../ai/summaryService');
const Message = require('../models/Message');

// Zeph AI — BullMQ worker for summary generation (Phase 9, observability
// Phase 11). A failed/unavailable AI result is NOT a job worth BullMQ's own
// exponential-backoff retry (the gateway has already classified and logged
// the reason) — but for a TRANSIENT failure the job must be REMOVED so its
// dedupe id (summary-{roomId}-{messageCount}) is free for a fresh request.
// Without this, a rate-limited summary attempt leaves a "completed" job
// whose id then silently blocks every re-enqueue for the 24h retention
// window — the summary would never generate until enough new messages
// changed the messageCount and thus the id.
const TRANSIENT_REASONS = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED', 'PROVIDER_UNAVAILABLE', 'GENERATION_IN_PROGRESS']);

const processSummaryJob = async (job) => {
  const { roomId, userId, conversationType, requestId } = job.data;
  // job.timestamp is set by BullMQ at enqueue time — the gap to "now" is
  // real queue wait time (Phase 11), distinct from provider latency
  // (measured separately inside runGoverned).
  const queueWaitMs = Date.now() - job.timestamp;
  const currentMessageCount = await Message.countDocuments({ room: roomId, type: 'text' });

  const result = await generateAndPersistSummary({
    roomId,
    userId,
    ip: 'queue',
    currentMessageCount,
    requestId,
    scope: conversationType,
  });

  if (!result.ok) {
    logger.info(
      {
        requestId,
        roomId,
        reason: result.reason,
        queueWaitMs,
        attemptsMade: job.attemptsMade,
      },
      'ai_worker_summary_unavailable',
    );
    if (TRANSIENT_REASONS.has(result.reason)) {
      // Free the dedupe id so the user's next summarize request enqueues a
      // fresh job instead of being silently swallowed as a "duplicate".
      await job.remove().catch((err) => logger.warn({ err, roomId }, 'ai_worker_transient_job_remove_failed'));
    }
    return;
  }
  logger.info(
    {
      requestId,
      roomId,
      queueWaitMs,
      attemptsMade: job.attemptsMade,
    },
    'ai_worker_summary_generated',
  );
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
  worker.on('failed', (job, err) =>
    logger.error(
      {
        err,
        requestId: job?.data?.requestId,
        roomId: job?.data?.roomId,
        attemptsMade: job?.attemptsMade,
      },
      'ai_worker_job_failed',
    ),
  );
  logger.info('Zeph AI worker started');
  return worker;
};

module.exports = { processSummaryJob, startAiWorker };
