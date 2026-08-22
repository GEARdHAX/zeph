const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const sharp = require('sharp');
const randomstring = require('randomstring');
const Media = require('../models/Media');
const storage = require('../storage');
const logger = require('../logger');
const mediaPolicy = require('../mediaPolicy');
const { isConsistentWithCategory } = require('../utils/sniffFileCategory');
const { inspectArchive } = require('../utils/inspectArchive');

// Unified upload endpoint for every media category EXCEPT profile/group
// avatar images and legacy general files — those keep using upload.js /
// upload-file.js unchanged (see DECISIONS.md). This route is what
// BottomBar.jsx's generalized attach flow calls for video/audio/pdf/
// document/archive/text, and for images sent through the same flow.
//
// Defense-in-depth order: authenticated (route is mounted behind passport
// jwt) -> extension categorization -> size limit -> content-sniffing ->
// archive-bomb heuristic -> filename sanitization -> storage write ->
// metadata persisted only after the write succeeds.
module.exports = async (req, res) => {
  const file = req.files.file;
  const poster = req.files.poster; // optional client-captured video poster frame

  if (!file) {
    return res.status(400).json({ status: 400, error: 'FILE_REQUIRED' });
  }

  const originalExtension = path.extname(file.name || '').toLowerCase();
  const category = mediaPolicy.categorizeFile(originalExtension);

  if (!category) {
    return res.status(415).json({ status: 415, error: 'FILE_TYPE_NOT_ALLOWED' });
  }

  const maxSize = mediaPolicy.getMaxSize(category);
  if (file.size > maxSize) {
    return res.status(413).json({ status: 413, error: 'FILE_TOO_LARGE' });
  }

  // Never trust the client's declared MIME type — verify the actual header
  // bytes match what the extension/category claims.
  if (!isConsistentWithCategory(file.path, category)) {
    return res.status(415).json({ status: 415, error: 'FILE_CONTENT_MISMATCH' });
  }

  if (category === 'archive' || category === 'document') {
    const inspection = inspectArchive(file.path, originalExtension);
    if (!inspection.safe) {
      logger.warn({ userId: req.user.id, reason: inspection.reason }, 'Rejected suspicious archive upload');
      return res.status(415).json({ status: 415, error: 'ARCHIVE_UNSAFE' });
    }
  }

  // originalName is a pure display string from here on — it is NEVER used
  // to build a filesystem/storage path (the storage key below is always a
  // random shieldedID-style value), so path-traversal via filename is not
  // reachable; this strips control characters purely so the UI never
  // renders anything unexpected.
  // eslint-disable-next-line no-control-regex
  const sanitizedName = (file.name || 'file').replace(/[\x00-\x1f/\\]/g, '').slice(0, 255);

  const shield = randomstring.generate({ length: 120, charset: 'alphanumeric', capitalization: 'lowercase' });
  const media = new Media({
    uploaderId: req.user.id,
    originalName: sanitizedName,
    mimeType: file.type,
    category,
    size: file.size,
    status: 'UPLOADING',
  });
  await media.save();

  const safeExtension = originalExtension && originalExtension.length <= 10 ? originalExtension : '.bin';
  const storageKey = `${req.user.id}/${shield}${media._id}${safeExtension}`;

  try {
    await storage.putObject(storageKey, fs.createReadStream(file.path), file.type);
  } catch (err) {
    logger.error({ err, mediaId: media._id }, 'Failed to write media object to storage');
    media.status = 'FAILED';
    await media.save().catch(() => {});
    return res.status(500).json({ status: 500, error: 'STORAGE_ERROR' });
  }

  media.storageKey = storageKey;

  // Thumbnails: images get a real resize via sharp (already a dependency,
  // same approach as upload.js). Video/PDF get no server-side frame
  // extraction (would need an ffmpeg binary — out of scope per the plan);
  // the client instead captures its own poster frame during editing and
  // uploads it as a second small image alongside the main file.
  if (category === 'image') {
    try {
      const thumbKey = `${req.user.id}/${shield}${media._id}-thumb.jpg`;
      const thumbBuffer = await sharp(file.path).rotate().resize({ width: 256 }).jpeg().toBuffer();
      await storage.putObject(thumbKey, Readable.from(thumbBuffer), 'image/jpeg');
      media.thumbnailKey = thumbKey;
      const dimensions = await sharp(file.path).metadata();
      media.width = dimensions.width;
      media.height = dimensions.height;
    } catch (err) {
      logger.warn({ err, mediaId: media._id }, 'Failed to generate image thumbnail (non-fatal)');
    }
  } else if (category === 'video' && poster) {
    try {
      const thumbKey = `${req.user.id}/${shield}${media._id}-thumb.jpg`;
      await storage.putObject(thumbKey, fs.createReadStream(poster.path), 'image/jpeg');
      media.thumbnailKey = thumbKey;
    } catch (err) {
      logger.warn({ err, mediaId: media._id }, 'Failed to store client-captured video poster (non-fatal)');
    }
  }

  media.status = 'READY';

  try {
    await media.save();
  } catch (err) {
    logger.error({ err, mediaId: media._id }, 'Failed to persist media metadata after upload');
    return res.status(500).json({ status: 500, error: 'DATABASE_ERROR' });
  }

  res.status(200).json({ status: 200, media });
};
