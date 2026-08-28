const path = require('path');
const randomstring = require('randomstring');
const Media = require('../models/Media');
const storage = require('../storage');
const logger = require('../logger');
const mediaPolicy = require('../mediaPolicy');

// Step 1 of the direct-to-R2 upload flow (see upload-media-complete.js for
// step 2). Only what's checkable WITHOUT the file's actual bytes runs here:
// extension/category allowlist + declared size. Content-sniffing and the
// archive-bomb heuristic (upload-media.js's other two defenses) need real
// bytes on disk, which this route never receives — the client uploads
// directly to R2, bypassing this Node process entirely. Those checks run in
// upload-media-complete.js instead, AFTER the bytes exist, with the object
// deleted from R2 if they fail. See DECISIONS.md and storage.js's
// getPresignedUploadUrl comment for the full security-tradeoff writeup.
//
// Callers MUST check GET /api/info's directUploadEnabled first — this 404s
// outright when R2 isn't configured (storage.getPresignedUploadUrl returns
// null), since local-disk mode has no direct-upload equivalent; the
// frontend falls back to the existing proxy-through-Node upload-media.js
// route entirely in that case, this route is never called.
module.exports = async (req, res) => {
  const { filename, size, poster } = req.fields;

  if (!filename || !size) {
    return res.status(400).json({ status: 400, error: 'FILENAME_AND_SIZE_REQUIRED' });
  }

  const originalExtension = path.extname(filename).toLowerCase();
  const category = mediaPolicy.categorizeFile(originalExtension);
  if (!category) {
    return res.status(415).json({ status: 415, error: 'FILE_TYPE_NOT_ALLOWED' });
  }

  const declaredSize = Number(size);
  const maxSize = mediaPolicy.getMaxSize(category);
  if (!Number.isFinite(declaredSize) || declaredSize <= 0 || declaredSize > maxSize) {
    return res.status(413).json({ status: 413, error: 'FILE_TOO_LARGE' });
  }

  // eslint-disable-next-line no-control-regex
  const sanitizedName = filename.replace(/[\x00-\x1f/\\]/g, '').slice(0, 255);
  const shield = randomstring.generate({ length: 120, charset: 'alphanumeric', capitalization: 'lowercase' });

  const media = new Media({
    uploaderId: req.user.id,
    originalName: sanitizedName,
    category,
    size: declaredSize,
    status: 'UPLOADING',
  });
  await media.save();

  const safeExtension = originalExtension && originalExtension.length <= 10 ? originalExtension : '.bin';
  const storageKey = `${req.user.id}/${shield}${media._id}${safeExtension}`;
  media.storageKey = storageKey;
  await media.save();

  const contentType = mediaPolicy.MEDIA_CATEGORIES[category].mimes[0];
  const uploadUrl = await storage.getPresignedUploadUrl(storageKey, contentType);
  if (!uploadUrl) {
    // R2 isn't actually configured — the frontend shouldn't have called
    // this route at all (see GET /api/info's directUploadEnabled), but
    // fail cleanly rather than hand back a null URL.
    media.status = 'FAILED';
    await media.save().catch(() => {});
    logger.warn({ mediaId: media._id }, 'upload-media-presign called but object storage is not configured');
    return res.status(501).json({ status: 501, error: 'DIRECT_UPLOAD_NOT_AVAILABLE' });
  }

  // Optional client-captured video poster frame — same small extra upload
  // upload-media.js already supports, presigned the same way so it never
  // proxies through Node either.
  let posterUploadUrl = null;
  let posterStorageKey = null;
  if (poster === 'true' && category === 'video') {
    posterStorageKey = `${req.user.id}/${shield}${media._id}-thumb.jpg`;
    posterUploadUrl = await storage.getPresignedUploadUrl(posterStorageKey, 'image/jpeg');
  }

  res.status(200).json({
    status: 200,
    mediaId: media._id,
    uploadUrl,
    storageKey,
    posterUploadUrl,
    posterStorageKey,
  });
};
