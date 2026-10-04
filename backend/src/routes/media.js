const path = require('path');
const Media = require('../models/Media');
const Message = require('../models/Message');
const Room = require('../models/Room');
const storage = require('../storage');
const cdn = require('../cdn');
const mediaPolicy = require('../mediaPolicy');
const groupPolicy = require('../authorization/groupPolicy');
const logger = require('../logger');

// Unlike the legacy /api/images/* and /api/files/* routes (unauthenticated,
// security-by-obscurity via an unguessable shieldedID — a known, accepted
// gap for old messages, see DECISIONS.md), every NEW media object is served
// through this authenticated route with a real room-membership check: the
// requester must actually be a participant in the room the referencing
// message belongs to.
const canAccessMedia = async (media, userId) => {
  const message = await Message.findOne({ media: media._id }).select('room');
  if (!message) return false;

  const room = await Room.findById(message.room).select('people isGroup disabledAt');
  if (!room || room.disabledAt) return false;

  if (room.isGroup) {
    const membership = await groupPolicy.getMembershipWithFallback(room._id, userId);
    return !!membership;
  }
  return room.people.some((p) => p.toString() === userId.toString());
};

const streamMedia = async (req, res, key, mimeType, category, filename) => {
  let stream;
  try {
    stream = await storage.getObjectStream(key);
  } catch (err) {
    logger.warn({ err, key }, 'Media object missing from storage');
    return res.status(404).json({ error: true });
  }

  res.set('Content-Type', mimeType || 'application/octet-stream');
  // DOWNLOAD_ONLY categories (document/archive/text) are never rendered
  // inline — forcing a download is what actually prevents an uploaded
  // HTML/JS file from ever executing at the app's own origin, regardless
  // of what a browser might otherwise try to do with the Content-Type.
  if (mediaPolicy.getSecurityLevel(category) === mediaPolicy.SecurityLevel.DOWNLOAD_ONLY) {
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'download')}"`);
  }
  stream.pipe(res);
  stream.on('error', (err) => {
    logger.error({ err, key }, 'Error streaming media object');
    if (!res.headersSent) res.status(500).end();
  });
};

module.exports = async (req, res) => {
  const { id } = req.params;

  const media = await Media.findById(id).catch(() => null);
  if (!media || media.status !== 'READY') {
    return res.status(404).json({ error: true });
  }

  const allowed = await canAccessMedia(media, req.user.id);
  if (!allowed) {
    logger.warn({ userId: req.user.id, mediaId: id }, 'Unauthorized media access rejected');
    return res.status(404).json({ error: true });
  }

  await streamMedia(req, res, media.storageKey, media.mimeType, media.category, media.originalName);
};

module.exports.thumbnail = async (req, res) => {
  const { id } = req.params;

  const media = await Media.findById(id).catch(() => null);
  if (!media || media.status !== 'READY' || !media.thumbnailKey) {
    return res.status(404).json({ error: true });
  }

  const allowed = await canAccessMedia(media, req.user.id);
  if (!allowed) {
    logger.warn({ userId: req.user.id, mediaId: id }, 'Unauthorized media thumbnail access rejected');
    return res.status(404).json({ error: true });
  }

  await streamMedia(req, res, media.thumbnailKey, 'image/jpeg', 'image', 'thumbnail.jpg');
};

// GET /api/media/:id/url and /api/media/:id/thumbnail/url - the CDN path. Same authentication and
// the same room-membership check as streaming; instead of the bytes the client gets a short-lived
// signed Cloudflare URL and loads the file from the edge (Range/seek works, Render is not in the
// data path). 404 CDN_NOT_ENABLED => the whole feature is off; 404 CDN_NOT_AVAILABLE => this
// particular object predates the CDN key scheme. Either way the client falls back to streaming.
const signedUrlFor = (thumbnail) => async (req, res) => {
  const { id } = req.params;
  if (!cdn.isEnabled()) return res.status(404).json({ error: 'CDN_NOT_ENABLED' });

  const media = await Media.findById(id).catch(() => null);
  if (!media || media.status !== 'READY' || (thumbnail && !media.thumbnailKey)) {
    return res.status(404).json({ error: true });
  }

  const allowed = await canAccessMedia(media, req.user.id);
  if (!allowed) {
    logger.warn({ userId: req.user.id, mediaId: id }, 'Unauthorized media URL request rejected');
    return res.status(404).json({ error: true });
  }

  let signed = null;
  try {
    if (thumbnail) {
      signed = cdn.createSignedDownloadUrl(media.thumbnailKey, { contentType: 'image/jpeg' });
    } else {
      signed = cdn.createSignedDownloadUrl(media.storageKey, {
        filename: media.originalName,
        attachment: mediaPolicy.getSecurityLevel(media.category) === mediaPolicy.SecurityLevel.DOWNLOAD_ONLY,
        contentType: media.mimeType || mediaPolicy.mimeForFile(path.extname(media.originalName || ''), media.category),
      });
    }
  } catch (err) {
    logger.error({ err, mediaId: id }, 'Failed to generate signed media URL');
    return res.status(500).json({ error: true });
  }
  if (!signed) return res.status(404).json({ error: 'CDN_NOT_AVAILABLE' });

  // The URL is a bearer credential: never let an intermediary store the response.
  res.set('Cache-Control', 'private, no-store');
  return res.status(200).json(signed);
};

module.exports.signedUrl = signedUrlFor(false);
module.exports.thumbnailSignedUrl = signedUrlFor(true);
