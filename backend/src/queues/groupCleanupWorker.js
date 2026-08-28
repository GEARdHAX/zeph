const { Worker } = require('bullmq');
const Message = require('../models/Message');
const Media = require('../models/Media');
const GroupInvite = require('../models/GroupInvite');
const storage = require('../storage');
const logger = require('../logger');
const { getQueueConnection } = require('./connection');
const { QUEUE_NAME } = require('./groupCleanup');

// Runs 24h (CLEANUP_DELAY_MS in groupCleanup.js) after a group is deleted —
// the group is already fully inaccessible via Room.disabledAt the instant
// group/delete.js runs; this only reclaims the now-unreachable storage and
// database rows behind it. Deliberately does NOT touch: Room (soft-delete
// is permanent, matches every other delete in this app), GroupMember rows
// (canReadRoomHistory/wasEverMember still need these for a former member's
// own inbox even after the group is gone), GroupAuditLog (audit history is
// meant to outlive the thing it audited), or the legacy Image/File
// collections (those back per-user profile pictures, never scoped to a
// single group/message — deleting them here would risk breaking an
// unrelated conversation's avatar). Only Message rows for this room, the
// Media objects those messages reference (both the DB row and its R2/local
// storage object), and this group's now-dead GroupInvite links are removed.
const processGroupCleanup = async (job) => {
  const { groupId } = job.data;

  const messages = await Message.find({ room: groupId }).select('_id media').lean();
  const mediaIds = messages.map((m) => m.media).filter(Boolean);

  if (mediaIds.length) {
    const mediaDocs = await Media.find({ _id: { $in: mediaIds } }).select('storageKey thumbnailKey').lean();
    await Promise.all(mediaDocs.flatMap((m) => [
      m.storageKey ? storage.deleteObject(m.storageKey) : null,
      m.thumbnailKey ? storage.deleteObject(m.thumbnailKey) : null,
    ].filter(Boolean)));
    await Media.deleteMany({ _id: { $in: mediaIds } });
  }

  const { deletedCount } = await Message.deleteMany({ room: groupId });
  await GroupInvite.deleteMany({ group: groupId });

  logger.info({ groupId, messagesDeleted: deletedCount, mediaDeleted: mediaIds.length }, 'group_cleanup_completed');
};

// Only started when Redis is configured — same best-effort posture as the
// Queue side (groupCleanup.js) and the Socket.IO adapter. No worker means
// enqueued jobs simply wait in Redis until a worker process picks them up;
// nothing is lost, cleanup is just deferred rather than skipped.
const startGroupCleanupWorker = () => {
  const connection = getQueueConnection();
  if (!connection) {
    logger.info('Group cleanup worker not started — Redis not configured');
    return null;
  }
  const worker = new Worker(QUEUE_NAME, processGroupCleanup, { connection });
  worker.on('failed', (job, err) => logger.error({ err, groupId: job?.data?.groupId }, 'group_cleanup_failed'));
  logger.info('Group cleanup worker started');
  return worker;
};

module.exports = { processGroupCleanup, startGroupCleanupWorker };
