const { Queue } = require('bullmq');
const { getQueueConnection } = require('./connection');
const logger = require('../logger');

const QUEUE_NAME = 'group-cleanup';

// Delay before a deleted group's messages/media are actually purged — long
// enough that an accidental delete has a real undo window (nothing today
// exposes an "undelete" action, but the room itself stays soft-deleted via
// Room.disabledAt regardless, so this delay costs nothing and buys margin).
// The group is already fully inaccessible the instant group/delete.js sets
// disabledAt — this job only removes the now-unreachable data behind it.
const CLEANUP_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours

let queue = null;

// Lazy singleton, same pattern as connection.js — group/delete.js calls this
// on every group deletion, so the Queue object (and its Redis connection) is
// created once, not per-call. Returns null when Redis isn't configured;
// callers already treat a missing queue as "cleanup deferred, not fatal" —
// see group/delete.js's try/catch around requiring this module.
const getQueue = () => {
  const connection = getQueueConnection();
  if (!connection) return null;
  if (!queue) queue = new Queue(QUEUE_NAME, { connection });
  return queue;
};

// Called from group/delete.js right after Room.disabledAt is set. Fire-
// and-forget by design (matches every other post-response side effect in
// that route — forceLeaveGroupRoom, broadcastToGroup): the HTTP response
// already went out before this resolves, so a failed enqueue is logged, not
// thrown — the group stays correctly inaccessible via disabledAt either way,
// the only consequence of a failed enqueue is stale data lingering in Mongo/
// R2 a bit longer, not a user-facing bug.
const enqueueGroupCleanup = async (groupId) => {
  const q = getQueue();
  if (!q) {
    logger.info({ groupId }, 'Group cleanup not enqueued — Redis not configured, skipping (data stays until manually cleaned)');
    return;
  }
  try {
    await q.add('cleanup', { groupId }, {
      delay: CLEANUP_DELAY_MS,
      // groupId as jobId — re-deleting an already-deleted group (route
      // itself already blocks this via the disabledAt 404 check, but belt-
      // and-suspenders) can never double-enqueue the same cleanup.
      jobId: groupId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    logger.info({ groupId, delayMs: CLEANUP_DELAY_MS }, 'Group cleanup job enqueued');
  } catch (err) {
    logger.warn({ err, groupId }, 'Failed to enqueue group cleanup job');
  }
};

module.exports = { QUEUE_NAME, CLEANUP_DELAY_MS, getQueue, enqueueGroupCleanup };
