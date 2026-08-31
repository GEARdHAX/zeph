const { Queue } = require('bullmq');
const { getQueueConnection } = require('./connection');
const logger = require('../logger');

const QUEUE_NAME = 'security-ai-analysis';

let queue = null;

// Lazy singleton, same pattern as groupCleanup.js. Returns null when Redis
// isn't configured — the caller (correlationHook.js) already treats a
// missing queue as "AI analysis deferred, not fatal," matching spec
// section 41's "security must NOT depend on AI availability."
const getQueue = () => {
  const connection = getQueueConnection();
  if (!connection) return null;
  if (!queue) queue = new Queue(QUEUE_NAME, { connection });
  return queue;
};

// jobId = incidentId (spec section 22: "jobs must be idempotent") — BullMQ
// refuses to enqueue a second job with an id already active/waiting, so
// correlateEvent() folding 50 more events into the SAME incident within a
// short window can call this 50 times without producing 50 queued AI
// analyses for one incident; the SECOND call for the same incidentId is a
// silent no-op at the BullMQ level.
const enqueueIncidentAnalysis = async (incidentId, priority) => {
  const q = getQueue();
  if (!q) {
    logger.info({ incidentId }, 'Security AI analysis not enqueued — Redis not configured, skipping');
    return;
  }
  try {
    await q.add('analyze-incident', { incidentId }, {
      jobId: `incident:${incidentId}`,
      priority, // BullMQ: LOWER number = higher priority (spec section 23's CRITICAL/HIGH/MEDIUM/LOW mapped to 1/2/3/4 by the caller)
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 60 * 60 }, // spec section 65 — bounded, not permanent queue-state retention
      removeOnFail: { age: 24 * 60 * 60 },
    });
  } catch (err) {
    logger.warn({ err, incidentId }, 'Failed to enqueue security AI analysis job');
  }
};

module.exports = { QUEUE_NAME, getQueue, enqueueIncidentAnalysis };
