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
const readHead = async (key, bytes) => {
  const stream = await storage.getObjectStream(key);
  const chunks = [];
  let length = 0;
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.length;
    if (length >= bytes) break;
  }
  if (typeof stream.destroy === 'function') stream.destroy();
  return Buffer.concat(chunks).slice(0, bytes);
};

const posterIsValid = async (key) => {
  try {
    const meta = await storage.getObjectMetadata(key);
    if (!meta || !meta.size || meta.size > mediaPolicy.MAX_POSTER_SIZE) return false;
    if (meta.contentType && meta.contentType.toLowerCase() !== 'image/jpeg') return false;
    const head = await readHead(key, 3);
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  } catch (err) {
    return false;
  }
};

module.exports = async (req, res) => {
  const { mediaId } = req.params;

  const media = await Media.findOne({ _id: mediaId, uploaderId: req.user.id });
  if (!media || media.status !== 'UPLOADING') {
    return res.status(404).json({ status: 404, error: 'MEDIA_NOT_FOUND' });
  }

  media.status = 'PROCESSING';
  await media.save();

  const originalExtension = path.extname(media.originalName || '').toLowerCase();
  const tempPath = path.join(
    os.tmpdir(),
    `upload-complete-${crypto.randomBytes(8).toString('hex')}${originalExtension}`,
  );

  const fail = async (reason, statusCode) => {
    await storage.deleteObject(media.storageKey).catch(() => {});
    if (media.thumbnailKey) await storage.deleteObject(media.thumbnailKey).catch(() => {});
    // A poster the client may already have uploaded next to a rejected file must not be left behind.
    await storage.deleteObject(`${media.storageKey}-thumb.jpg`).catch(() => {});
    media.status = 'FAILED';
    await media.save().catch(() => {});
    fs.promises.unlink(tempPath).catch(() => {});
    logger.warn({ mediaId, reason }, 'Rejected direct-upload media after post-upload validation');
    return res.status(statusCode).json({ status: statusCode, error: reason });
  };

  // What actually reached R2 can differ from what the client declared at presign time: check it
  // with a HEAD (no download) before spending time/bandwidth on the object. This also closes the
  // gap where a client declares a small size, then uploads a file over the category limit.
  let metadata;
  try {
    metadata = await storage.getObjectMetadata(media.storageKey);
  } catch (err) {
    logger.error({ err, mediaId }, 'Failed to read uploaded object metadata');
    return fail('STORAGE_ERROR', 500);
  }
  if (!metadata) return fail('OBJECT_NOT_FOUND', 404);
  if (metadata.size > mediaPolicy.getMaxSize(media.category)) return fail('FILE_TOO_LARGE', 413);
  media.size = metadata.size;
  // The signed upload bound the type, so R2 should hold exactly what the extension implies. Anything else means the
  // object did not come through the signed path.
  const expectedType = mediaPolicy.mimeForFile(originalExtension, media.category);
  if (metadata.contentType && metadata.contentType.toLowerCase() !== expectedType) return fail('CONTENT_TYPE_MISMATCH', 415);

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

  if (!isConsistentWithCategory(tempPath, media.category, originalExtension)) {
    return fail('FILE_CONTENT_MISMATCH', 415);
  }

  if (media.category === 'archive' || media.category === 'document') {
    const inspection = inspectArchive(tempPath, originalExtension);
    if (!inspection.safe) {
      logger.warn(
        { userId: req.user.id, mediaId, reason: inspection.reason },
        'Rejected suspicious direct-upload archive',
      );
      return fail('ARCHIVE_UNSAFE', 415);
    }
  }

  // Thumbnails — same generation logic as upload-media.js, just reading
  // from the downloaded temp file instead of formidable's own temp file.
  if (media.category === 'image') {
    try {
      const thumbKey = `${media.storageKey}-thumb.jpg`;
      const thumbBuffer = await sharp(tempPath).rotate().resize({ width: 256 }).jpeg().toBuffer();
      await storage.putObject(thumbKey, Readable.from(thumbBuffer), 'image/jpeg', { cacheControl: 'private, no-store' });
      media.thumbnailKey = thumbKey;
      const dimensions = await sharp(tempPath).metadata();
      media.width = dimensions.width;
      media.height = dimensions.height;
    } catch (err) {
      logger.warn({ err, mediaId }, 'Failed to generate image thumbnail (non-fatal)');
    }
  }
  // Video poster frames are uploaded directly by the client (see upload-media-presign.js). The key is DERIVED here and
  // the client's value is only a flag: taking it as given would let a client point its thumbnail at any object,
  // including another user's private file, and then read it through the thumbnail route. The poster is also
  // validated (size cap, JPEG content) before it is kept.
  if (media.category === 'video' && req.fields.posterStorageKey) {
    const posterKey = `${media.storageKey}-thumb.jpg`;
    if (req.fields.posterStorageKey === posterKey && (await posterIsValid(posterKey))) {
      media.thumbnailKey = posterKey;
    } else {
      logger.warn({ mediaId }, 'Ignored an invalid or foreign video poster');
      await storage.deleteObject(posterKey).catch(() => {});
    }
  }

  // Served with this type by the CDN / media route; derived from the validated extension.
  media.mimeType = mediaPolicy.mimeForFile(originalExtension, media.category);
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
