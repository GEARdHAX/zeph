const { Worker } = require('bullmq');
const logger = require('../logger');
const { getQueueConnection } = require('./connection');
const { QUEUE_NAME } = require('./meetingAiQueue');
const { transcribeMeetingAudio, generateMeetingSummary } = require('../ai/meetingTranscriptService');

// Zeph AI — Meeting AI BullMQ worker (Phase 14). Two-stage job: transcribe
// (if a mediaId is present — i.e. this is the first run for this meeting)
// then summarize. Both stages fail toward "no summary, meeting itself
// unaffected" — same posture as every other Zeph AI worker.
//
// Same transient-vs-permanent distinction as aiWorker.js: a rate-limited /
// provider-unavailable attempt must REMOVE the job so its dedupe id
// (meeting:{meetingId}) doesn't silently block the user's retry for the
// retention window. RATE_LIMITED/TRANSCRIPTION_FAILED/etc are transient;
// MEETING_TOO_SHORT/INSUFFICIENT_* are permanent eligibility verdicts that
// SHOULD keep the id (retrying changes nothing).
const TRANSIENT_REASONS = new Set([
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'PROVIDER_UNAVAILABLE',
  'GENERATION_IN_PROGRESS',
  'TRANSCRIPTION_FAILED',
  'AUDIO_FETCH_FAILED',
]);

const processMeetingJob = async (job) => {
  const { meetingId, mediaId, userId, requestId } = job.data;
  const queueWaitMs = Date.now() - job.timestamp;
  const removeIfTransient = async (reason) => {
    if (TRANSIENT_REASONS.has(reason)) {
      await job
        .remove()
        .catch((err) => logger.warn({ err, meetingId }, 'meeting_ai_worker_transient_job_remove_failed'));
    }
  };

  if (mediaId) {
    const transcribeResult = await transcribeMeetingAudio({ meetingId, mediaId, userId });
    if (!transcribeResult.ok) {
      logger.info(
        {
          requestId,
          meetingId,
          reason: transcribeResult.reason,
          queueWaitMs,
        },
        'meeting_ai_worker_transcription_unavailable',
      );
      await removeIfTransient(transcribeResult.reason);
      return;
    }
  }

  const summaryResult = await generateMeetingSummary({ meetingId, userId, requestId });
  if (!summaryResult.ok) {
    logger.info(
      {
        requestId,
        meetingId,
        reason: summaryResult.reason,
        queueWaitMs,
      },
      'meeting_ai_worker_summary_unavailable',
    );
    await removeIfTransient(summaryResult.reason);
    return;
  }
  logger.info({ requestId, meetingId, queueWaitMs }, 'meeting_ai_worker_summary_generated');
};

// concurrency:1 — transcription is the heaviest single operation Zeph AI
// performs (a large audio upload, held in memory as a Buffer); running more
// than one at a time on a portfolio-scale deployment risks memory pressure
// for no real throughput benefit at this traffic scale.
const startMeetingAiWorker = () => {
  const connection = getQueueConnection();
  if (!connection) {
    logger.info('Meeting AI worker not started — Redis not configured');
    return null;
  }
  const worker = new Worker(QUEUE_NAME, processMeetingJob, { connection, concurrency: 1 });
  worker.on('error', (err) => logger.throttledWarn('meeting-ai-worker', 30000, { err }, 'meeting_ai_worker_error'));
  worker.on('failed', (job, err) =>
    logger.error(
      {
        err,
        meetingId: job?.data?.meetingId,
        attemptsMade: job?.attemptsMade,
      },
      'meeting_ai_worker_job_failed',
    ),
  );
  logger.info('Meeting AI worker started');
  return worker;
};

module.exports = { processMeetingJob, startMeetingAiWorker };
