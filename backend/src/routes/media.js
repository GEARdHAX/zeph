const Media = require('../models/Media');
const Message = require('../models/Message');
const Room = require('../models/Room');
const storage = require('../storage');
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
    return res.status(404).json({ error: true });
  }

  await streamMedia(req, res, media.thumbnailKey, 'image/jpeg', 'image', 'thumbnail.jpg');
};
