const { Worker } = require('bullmq');
const Media = require('../models/Media');
const Message = require('../models/Message');
const storage = require('../storage');
const logger = require('../logger');
const { getQueueConnection, createQueue } = require('./connection');

const QUEUE_NAME = 'media-cleanup';

// Removes a media attachment's bytes (original, thumbnail/poster) from storage and its Media row, but ONLY if no
// message references it any more (a forward could share one Media). Safe to re-run: deleting a missing object or row
// is a no-op, which is what lets BullMQ retry it after a transient R2 failure.
const purgeMedia = async (mediaId) => {
  if (await Message.exists({ media: mediaId })) return false;
  const media = await Media.findById(mediaId).select('storageKey thumbnailKey').lean();
  if (!media) return false;

  const keys = new Set([media.storageKey, media.thumbnailKey, media.storageKey && `${media.storageKey}-thumb.jpg`]);
  await Promise.all([...keys].filter(Boolean).map((key) => storage.deleteObject(key)));
  await Media.deleteOne({ _id: mediaId });
  return true;
};

let queue = null;
const getQueue = () => {
  const connection = getQueueConnection();
  if (!connection) return null;
  if (!queue) queue = createQueue(QUEUE_NAME, connection);
  return queue;
};

// Called after the message that referenced the media has been saved without it, so the delete response never waits on
// storage. With Redis it is a retried job; without Redis (local dev) it runs in-process, best effort.
const enqueueMediaCleanup = async (mediaId) => {
  if (!mediaId) return;
  const id = String(mediaId);
  const q = getQueue();
  if (!q) {
    purgeMedia(id).catch((err) => logger.warn({ err, mediaId: id }, 'media_cleanup_inline_failed'));
    return;
  }
  try {
    await q.add(
      'purge',
      { mediaId: id },
      {
        jobId: id, // one job per media: a double delete cannot enqueue it twice
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
  } catch (err) {
    logger.warn({ err, mediaId: id }, 'media_cleanup_enqueue_failed');
  }
};

const startMediaCleanupWorker = () => {
  const connection = getQueueConnection();
  if (!connection) return null;
  const worker = new Worker(QUEUE_NAME, (job) => purgeMedia(job.data.mediaId), { connection });
  worker.on('error', (err) => logger.throttledWarn('media-cleanup-worker', 30000, { err }, 'media_cleanup_worker_error'));
  worker.on('failed', (job, err) => logger.error({ err, mediaId: job?.data?.mediaId }, 'media_cleanup_failed'));
  logger.info('Media cleanup worker started');
  return worker;
};

module.exports = { QUEUE_NAME, purgeMedia, enqueueMediaCleanup, startMediaCleanupWorker };
