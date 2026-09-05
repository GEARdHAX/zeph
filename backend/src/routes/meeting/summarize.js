const Meeting = require('../../models/Meeting');
const MeetingTranscript = require('../../models/MeetingTranscript');
const Media = require('../../models/Media');
const groupPolicy = require('../../authorization/groupPolicy');
const store = require('../../store');
const { getProvider } = require('../../ai/provider');
const { REJECTION_REASONS } = require('../../ai/policy');
const { generateMeetingSummary, transcribeMeetingAudio } = require('../../ai/meetingTranscriptService');
const { enqueueMeetingSummaryJob, getQueue } = require('../../queues/meetingAiQueue');
const { resolveRequestId } = require('../../ai/telemetry');

// Zeph AI — Meeting AI (Phase 14). POST /api/meeting/:id/summarize —
// { mediaId } for the FIRST call (client already uploaded the recorded
// audio via the existing /api/upload/media route, category 'audio');
// omit mediaId on subsequent calls once a transcript already exists (e.g.
// retrying summary generation after a transient provider failure).
//
// Authorization mirrors mediasoup/index.js's authorizeMeetingJoin exactly
// (caller/callee/recorded participant/current group member) — kept as an
// independent, small check here rather than importing mediasoup/index.js,
// which would pull in native mediasoup binding initialization this route
// has no reason to depend on (Meeting AI must work even when
// MEDIASOUP_ENABLED=false, since mediasoup is disabled in this app's own
// production deployment — see docs/PHASE8-CAPACITY-REPORT.md).
const authorizeMeetingAccess = async (meeting, userId) => {
  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return true;
  if (meeting.callee && meeting.callee.toString() === userIdStr) return true;
  if ((meeting.users || []).some((u) => u.toString() === userIdStr)) return true;
  if (meeting.group) {
    const membership = await groupPolicy.getMembershipWithFallback(meeting.group, userIdStr);
    if (membership) return true;
  }
  return false;
};

module.exports = async (req, res) => {
  const requestId = resolveRequestId(req);
  const { id: meetingId } = req.params;
  const { mediaId } = req.fields;

  const config = store.config;
  if (config.aiProvider !== 'groq' || !config.groqApiKey || !getProvider(config).enabled) {
    return res.status(503).json({
      error: true, reason: REJECTION_REASONS.AI_DISABLED, message: 'Meeting AI requires the Groq provider to be configured on this server.', requestId,
    });
  }

  const meeting = await Meeting.findById(meetingId).catch(() => null);
  if (!meeting) return res.status(404).json({ error: true, requestId });

  const authorized = await authorizeMeetingAccess(meeting, req.user.id);
  if (!authorized) return res.status(403).json({ error: true, requestId });

  if (mediaId) {
    const media = await Media.findOne({ _id: mediaId, uploaderId: req.user.id, category: 'audio' });
    if (!media) return res.status(404).json({ error: true, reason: 'MEDIA_NOT_FOUND', requestId });
  } else {
    const existing = await MeetingTranscript.findOne({ meeting: meetingId });
    if (!existing || !existing.transcript) {
      return res.status(400).json({ error: true, reason: 'NO_TRANSCRIPT_YET', message: 'No recording has been uploaded for this meeting yet.', requestId });
    }
  }

  if (getQueue()) {
    await enqueueMeetingSummaryJob({
      meetingId, mediaId, userId: req.user.id, requestId,
    });
    return res.status(202).json({
      status: 'PROCESSING', message: mediaId ? 'Transcribing and summarizing your meeting recording.' : 'Generating a summary from the existing transcript.', requestId,
    });
  }

  // Synchronous fallback (no Redis/BullMQ) — transcription+summary can be
  // slow, but every other Zeph AI route already permits this fallback
  // (Phase 9), and a portfolio deployment without Redis still gets a
  // working, just-slower, Meeting AI feature rather than none at all.
  if (mediaId) {
    const transcribeResult = await transcribeMeetingAudio({ meetingId, mediaId, userId: req.user.id });
    if (!transcribeResult.ok) {
      return res.status(502).json({
        error: true, reason: transcribeResult.reason, message: 'Could not transcribe the meeting recording.', requestId,
      });
    }
  }

  const result = await generateMeetingSummary({ meetingId, userId: req.user.id, requestId });
  if (!result.ok) {
    const status = result.reason === REJECTION_REASONS.RATE_LIMITED || result.reason === REJECTION_REASONS.QUOTA_EXCEEDED ? 429
      : (result.reason === 'MEETING_TOO_SHORT' || result.reason === 'INSUFFICIENT_PARTICIPANTS' || result.reason === 'INSUFFICIENT_TRANSCRIPT' || result.reason === 'MEETING_NOT_ENDED') ? 422 : 502;
    return res.status(status).json({
      error: true, reason: result.reason, message: meetingEligibilityMessage(result), requestId,
    });
  }
  res.status(200).json({
    summary: result.text || result.summary, cached: !!result.cached, requestId: result.requestId || requestId,
  });
};

// Human-readable explanations for each meeting-specific rejection reason —
// Phase 22's "explain why an AI operation is unavailable," meeting-flavored.
function meetingEligibilityMessage(result) {
  switch (result.reason) {
    case 'MEETING_NOT_ENDED':
      return 'This meeting has not ended yet.';
    case 'MEETING_TOO_SHORT':
      return `This meeting was too short to summarize. Minimum duration: ${Math.round(result.minDurationSeconds / 60)} minutes.`;
    case 'INSUFFICIENT_PARTICIPANTS':
      return `This meeting needs at least ${result.minParticipants} participants to generate a useful summary.`;
    case 'INSUFFICIENT_TRANSCRIPT':
      return `Not enough was said in this meeting to generate a useful summary (minimum ${result.minTranscriptWords} words transcribed).`;
    default:
      return 'AI provider request failed.';
  }
}
