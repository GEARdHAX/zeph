const { Queue } = require('bullmq');
const { getQueueConnection } = require('./connection');
const logger = require('../logger');

// Zeph AI — Meeting AI BullMQ queue (Phase 14). Separate queue from
// aiQueue.js (conversation summaries) — different job shape/duration
// (transcription can take much longer than a single chat-completion call),
// so keeping them independent means a burst of meeting transcriptions never
// starves conversation-summary throughput or vice versa.
const QUEUE_NAME = 'zeph-ai-meeting';

let queue = null;
const getQueue = () => {
  const connection = getQueueConnection();
  if (!connection) return null;
  if (!queue) queue = new Queue(QUEUE_NAME, { connection });
  return queue;
};

// jobId = meetingId — BullMQ refuses a second job with the same id while
// one is active/waiting, so a duplicate "generate summary" click while
// transcription/summarization is already running enqueues nothing new
// (Phase 14: "Prevent duplicate summary generation").
const enqueueMeetingSummaryJob = async ({
  meetingId, mediaId, userId, requestId,
}) => {
  const q = getQueue();
  if (!q) return { enqueued: false };
  try {
    await q.add('process-meeting', {
      meetingId, mediaId, userId, requestId,
    }, {
      jobId: `meeting:${meetingId}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      timeout: 120000, // transcription of up to a 25MB audio file can genuinely take a while
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 24 * 60 * 60 },
    });
    return { enqueued: true };
  } catch (err) {
    logger.warn({ err, meetingId }, 'meeting_ai_enqueue_failed');
    return { enqueued: false };
  }
};

module.exports = { QUEUE_NAME, getQueue, enqueueMeetingSummaryJob };
