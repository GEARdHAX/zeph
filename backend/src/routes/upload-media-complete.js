const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const sharp = require('sharp');
const Media = require('../models/Media');
const storage = require('../storage');
const logger = require('../logger');
const mediaPolicy = require('../mediaPolicy');
const { isConsistentWithCategory } = require('../utils/sniffFileCategory');
const { inspectArchive } = require('../utils/inspectArchive');

// Step 2 of the direct-to-R2 upload flow (see upload-media-presign.js for
// step 1). The client has already PUT the bytes straight to R2 by the time
// this runs — this route downloads them back down to a local temp file and
// runs the EXACT SAME two checks upload-media.js already ran before ever
// trusting an upload (content-sniff via isConsistentWithCategory, archive-
// bomb heuristic via inspectArchive — both need random-access `fs` reads on
// a real file, not a stream, hence downloading to temp rather than sniffing
// in-flight). A file that fails either check is deleted from R2 immediately
// and the Media doc marked FAILED — there's a brief window between the
// client's PUT finishing and this route running where an unvalidated object
// exists in R2, but it is never referenced by any Message until this route
// marks it READY, so nothing in the app can render/serve it in that window.
module.exports = async (req, res) => {
  const { mediaId } = req.params;

  const media = await Media.findOne({ _id: mediaId, uploaderId: req.user.id });
  if (!media || media.status !== 'UPLOADING') {
    return res.status(404).json({ status: 404, error: 'MEDIA_NOT_FOUND' });
  }

  media.status = 'PROCESSING';
  await media.save();

  const originalExtension = path.extname(media.originalName || '').toLowerCase();
  const tempPath = path.join(os.tmpdir(), `upload-complete-${crypto.randomBytes(8).toString('hex')}${originalExtension}`);

  const fail = async (reason, statusCode) => {
    await storage.deleteObject(media.storageKey).catch(() => {});
    if (media.thumbnailKey) await storage.deleteObject(media.thumbnailKey).catch(() => {});
    media.status = 'FAILED';
    await media.save().catch(() => {});
    fs.promises.unlink(tempPath).catch(() => {});
    logger.warn({ mediaId, reason }, 'Rejected direct-upload media after post-upload validation');
    return res.status(statusCode).json({ status: statusCode, error: reason });
  };

  let stream;
  try {
    stream = await storage.getObjectStream(media.storageKey);
  } catch (err) {
    return fail('OBJECT_NOT_FOUND', 404);
  }

  try {
    await new Promise((resolve, reject) => {
      const writable = fs.createWriteStream(tempPath);
      stream.pipe(writable);
      writable.on('finish', resolve);
      writable.on('error', reject);
      stream.on('error', reject);
    });
  } catch (err) {
    logger.error({ err, mediaId }, 'Failed to download uploaded media for validation');
    return fail('DOWNLOAD_FAILED', 500);
  }

  if (!isConsistentWithCategory(tempPath, media.category)) {
    return fail('FILE_CONTENT_MISMATCH', 415);
  }

  if (media.category === 'archive' || media.category === 'document') {
    const inspection = inspectArchive(tempPath, originalExtension);
    if (!inspection.safe) {
      logger.warn({ userId: req.user.id, mediaId, reason: inspection.reason }, 'Rejected suspicious direct-upload archive');
      return fail('ARCHIVE_UNSAFE', 415);
    }
  }

  // Thumbnails — same generation logic as upload-media.js, just reading
  // from the downloaded temp file instead of formidable's own temp file.
  if (media.category === 'image') {
    try {
      const thumbKey = `${media.storageKey}-thumb.jpg`;
      const thumbBuffer = await sharp(tempPath).rotate().resize({ width: 256 }).jpeg().toBuffer();
      await storage.putObject(thumbKey, Readable.from(thumbBuffer), 'image/jpeg');
      media.thumbnailKey = thumbKey;
      const dimensions = await sharp(tempPath).metadata();
      media.width = dimensions.width;
      media.height = dimensions.height;
    } catch (err) {
      logger.warn({ err, mediaId }, 'Failed to generate image thumbnail (non-fatal)');
    }
  }
  // Video poster frames are uploaded directly by the client to
  // posterStorageKey (see upload-media-presign.js) — if that upload
  // happened, the key is already known; just confirm it and record it.
  if (media.category === 'video' && req.fields.posterStorageKey) {
    media.thumbnailKey = req.fields.posterStorageKey;
  }

  media.status = 'READY';

  try {
    await media.save();
  } catch (err) {
    logger.error({ err, mediaId }, 'Failed to persist media metadata after direct-upload validation');
    return res.status(500).json({ status: 500, error: 'DATABASE_ERROR' });
  } finally {
    fs.promises.unlink(tempPath).catch(() => {});
  }

  res.status(200).json({ status: 200, media });
};
