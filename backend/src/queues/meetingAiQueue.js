const { getQueueConnection, createQueue } = require('./connection');
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
  if (!queue) queue = createQueue(QUEUE_NAME, connection);
  return queue;
};

// jobId includes a timestamp so a retry is NEVER silently swallowed by
// BullMQ's "id already exists" dedup. The old `meeting-{meetingId}` id was a
// trap: a completed/failed job stays in the queue for `removeOnComplete.age`
// (24h), so any later retry click added nothing, the route still returned
// 202, and the frontend polled a summary that would never come. Duplicate-
// generation is prevented instead by the route (routes/meeting/summarize.js)
// checking the MeetingTranscript status before enqueueing.
const enqueueMeetingSummaryJob = async ({ meetingId, mediaId, userId, requestId }) => {
  const q = getQueue();
  if (!q) return { enqueued: false };
  try {
    await q.add(
      'process-meeting',
      {
        meetingId,
        mediaId,
        userId,
        requestId,
      },
      {
        jobId: `meeting-${meetingId}-${Date.now()}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        timeout: 120000, // transcription of up to a 25MB audio file can genuinely take a while
        removeOnComplete: { age: 60 * 60 },
        removeOnFail: { age: 60 * 60 },
      },
    );
    return { enqueued: true };
  } catch (err) {
    logger.warn({ err, meetingId }, 'meeting_ai_enqueue_failed');
    return { enqueued: false };
  }
};

module.exports = { QUEUE_NAME, getQueue, enqueueMeetingSummaryJob };
