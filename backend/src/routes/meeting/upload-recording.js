const fs = require('fs');
const path = require('path');
const randomstring = require('randomstring');
const Meeting = require('../../models/Meeting');
const Media = require('../../models/Media');
const storage = require('../../storage');
const logger = require('../../logger');
const mediaPolicy = require('../../mediaPolicy');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');

// Zeph AI — Meeting AI. POST /api/meeting/:id/upload-recording — a narrow
// alternative to the general /api/upload/media pipeline, used ONLY when
// MeetingRecorder.jsx's client couldn't record in a container the general
// pipeline can classify unambiguously (see that file's comment): WebM and
// MP4 share the same container-level magic bytes between an audio-only and
// a video stream, so backend/src/utils/sniffFileCategory.js's byte sniffer
// always reports 'video' for either — the general route would then reject
// this exact case as FILE_CONTENT_MISMATCH.
//
// This route accepts that ambiguity deliberately rather than trying to
// resolve it: it forces category:'audio' unconditionally instead of
// sniffing, which is safe ONLY because of what's still enforced —
// authenticated + meeting-participant only (not the public upload surface),
// a fixed narrow extension allowlist (webm/mp4/m4a — real audio-capable
// container formats, not "anything"), and the same audio size cap as the
// general pipeline. It does not skip validation; it skips ONE check that is
// structurally incapable of returning a useful answer for this content type.
//
// Meeting-summary-persistence pass: authorization narrowed to Meeting.users
// (actual join history), same as get-summary.js/summarize.js — this route
// only ever fires right after the uploading user's OWN call just ended
// (callManager.js's finalizeMeetingRecording), so they are always already
// in meeting.users by the time this runs; a current-group-member fallback
// was never actually needed here.
const authorizeMeetingAccess = (meeting, userId) => {
  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return true;
  if (meeting.callee && meeting.callee.toString() === userIdStr) return true;
  return (meeting.users || []).some((u) => u.toString() === userIdStr);
};

const ALLOWED_EXTENSIONS = new Set(['.webm', '.mp4', '.m4a']);

module.exports = async (req, res) => {
  const { id: meetingId } = req.params;
  const file = req.files.file;
  const context = securityEventContext(req);

  const recordRejection = (reason, extra = {}) =>
    SecurityEventService.record({
      type: 'FILE_UPLOAD_REJECTED',
      severity: 'medium',
      actor: { userId: req.user.id },
      source: context,
      target: { resource: 'meeting_recording_upload', resourceId: meetingId, action: 'upload' },
      result: 'blocked',
      metadata: { reason, fileName: file?.name || null, mimeType: file?.type || null, size: file?.size || null, ...extra },
    });

  const meeting = await Meeting.findById(meetingId).catch(() => null);
  if (!meeting) return res.status(404).json({ error: true });

  if (!authorizeMeetingAccess(meeting, req.user.id)) {
    return res.status(403).json({ error: true, reason: 'NOT_A_PARTICIPANT' });
  }

  if (!file) {
    recordRejection('FILE_REQUIRED');
    return res.status(400).json({ error: true, reason: 'FILE_REQUIRED' });
  }

  const originalExtension = path.extname(file.name || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(originalExtension)) {
    recordRejection('FILE_TYPE_NOT_ALLOWED', { extension: originalExtension });
    return res.status(415).json({ error: true, reason: 'FILE_TYPE_NOT_ALLOWED' });
  }

  const maxSize = mediaPolicy.getMaxSize('audio');
  if (file.size > maxSize) {
    recordRejection('FILE_TOO_LARGE', { extension: originalExtension, maxSize });
    return res.status(413).json({ error: true, reason: 'FILE_TOO_LARGE' });
  }

  const shield = randomstring.generate({ length: 120, charset: 'alphanumeric', capitalization: 'lowercase' });
  const media = new Media({
    uploaderId: req.user.id,
    // eslint-disable-next-line no-control-regex -- same sanitization as upload-media.js: strip control chars, never used as a path
    originalName: (file.name || 'recording').replace(/[\x00-\x1f/\\]/g, '').slice(0, 255),
    mimeType: file.type,
    category: 'audio',
    size: file.size,
    status: 'UPLOADING',
  });
  await media.save();

  const storageKey = `${req.user.id}/${shield}${media._id}${originalExtension}`;
  try {
    await storage.putObject(storageKey, fs.createReadStream(file.path), file.type);
  } catch (err) {
    logger.error({ err, mediaId: media._id }, 'Failed to write meeting recording to storage');
    media.status = 'FAILED';
    await media.save().catch(() => {});
    return res.status(500).json({ error: true, reason: 'STORAGE_ERROR' });
  }

  media.storageKey = storageKey;
  media.status = 'READY';
  try {
    await media.save();
  } catch (err) {
    logger.error({ err, mediaId: media._id }, 'Failed to persist meeting recording metadata');
    return res.status(500).json({ error: true, reason: 'DATABASE_ERROR' });
  }

  SecurityEventService.record({
    type: 'FILE_UPLOAD',
    severity: 'low',
    actor: { userId: req.user.id },
    source: context,
    target: { resource: 'meeting_recording_upload', resourceId: media._id.toString(), action: 'upload' },
    result: 'success',
    metadata: { mimeType: media.mimeType, size: media.size, extension: originalExtension },
  });

  res.status(200).json({ status: 200, media });
};
