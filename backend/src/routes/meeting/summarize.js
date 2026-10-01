const Meeting = require('../../models/Meeting');
const MeetingTranscript = require('../../models/MeetingTranscript');
const Media = require('../../models/Media');
const store = require('../../store');
const { aiTextEnabled } = require('../../ai/providerRouter');
const { REJECTION_REASONS, buildPolicy } = require('../../ai/policy');
const { checkMeetingSummaryEligibility } = require('../../ai/eligibility');
const { generateMeetingSummary, transcribeMeetingAudio } = require('../../ai/meetingTranscriptService');
const { enqueueMeetingSummaryJob, getQueue } = require('../../queues/meetingAiQueue');
const { resolveRequestId, aiFailureResponse } = require('../../ai/telemetry');
const { isAuthorizedForMeetingHistory } = require('../../authorization/meetingInvitePolicy');

// Zeph AI — Meeting AI (Phase 14). POST /api/meeting/:id/summarize —
// { mediaId } for the FIRST call (client already uploaded the recorded
// audio via the existing /api/upload/media route, category 'audio');
// omit mediaId on subsequent calls once a transcript already exists (e.g.
// retrying summary generation after a transient provider failure).
//
// Authorization: requesting/generating a summary is participant-history-
// scoped, same as viewing one (routes/meeting/get-summary.js) — see
// authorization/meetingInvitePolicy.js's isAuthorizedForMeetingHistory for
// the full reasoning.

module.exports = async (req, res) => {
  const requestId = resolveRequestId(req);
  const { id: meetingId } = req.params;
  const { mediaId } = req.fields;

  const config = store.config;
  // Meeting AI needs a transcription-capable provider (Gemini multimodal or
  // Groq Whisper) — Ollama has no STT. aiTextEnabled covers gemini/groq;
  // ollama-only deployments correctly get the 503.
  if (!aiTextEnabled(config) || config.aiProvider === 'ollama') {
    return res.status(503).json({
      error: true,
      reason: REJECTION_REASONS.AI_DISABLED,
      message: 'Meeting AI requires the Gemini or Groq provider to be configured on this server.',
      requestId,
    });
  }

  const meeting = await Meeting.findById(meetingId).catch(() => null);
  if (!meeting) return res.status(404).json({ error: true, requestId });

  if (!(await isAuthorizedForMeetingHistory(meeting, req.user.id))) {
    return res.status(403).json({ error: true, reason: 'NOT_A_PARTICIPANT', requestId });
  }

  // Eligibility that doesn't need a transcript (meeting ended? long enough?
  // enough participants?) runs HERE, synchronously, before anything is
  // queued — otherwise the BullMQ path returns 202 and the worker only
  // discovers the meeting is ineligible AFTER paying for transcription,
  // with the rejection buried in a log line the user never sees.
  // (INSUFFICIENT_TRANSCRIPT still can't be checked until transcription
  // runs — that verdict is persisted by the worker for the frontend poll.)
  const eligibility = await checkMeetingSummaryEligibility(buildPolicy(config), meeting);
  if (!eligibility.eligible) {
    return res.status(422).json({
      error: true,
      reason: eligibility.reason,
      message: meetingEligibilityMessage(eligibility),
      requestId,
    });
  }

  const existingDoc = await MeetingTranscript.findOne({ meeting: meetingId });

  // Duplicate-generation guard (replaces the old jobId-based dedup, which
  // silently swallowed retries — see meetingAiQueue.js). A doc genuinely
  // in-flight (updated within the last 3 min) means "already working";
  // anything older is a stuck job we let the caller restart.
  if (
    existingDoc &&
    ['TRANSCRIBING', 'SUMMARIZING'].includes(existingDoc.status) &&
    Date.now() - new Date(existingDoc.updatedAt).getTime() < 3 * 60 * 1000
  ) {
    return res.status(202).json({ status: 'PROCESSING', message: 'Already generating a summary.', requestId });
  }

  if (mediaId) {
    const media = await Media.findOne({ _id: mediaId, uploaderId: req.user.id, category: 'audio' });
    if (!media) return res.status(404).json({ error: true, reason: 'MEDIA_NOT_FOUND', requestId });
  } else if (!existingDoc || !existingDoc.transcript) {
    return res.status(400).json({
      error: true,
      reason: 'NO_TRANSCRIPT_YET',
      message: 'No recording has been uploaded for this meeting yet.',
      requestId,
    });
  }

  if (getQueue()) {
    await enqueueMeetingSummaryJob({
      meetingId,
      mediaId,
      userId: req.user.id,
      requestId,
    });
    return res.status(202).json({
      status: 'PROCESSING',
      message: mediaId
        ? 'Transcribing and summarizing your meeting recording.'
        : 'Generating a summary from the existing transcript.',
      requestId,
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
        error: true,
        reason: transcribeResult.reason,
        message: 'Could not transcribe the meeting recording.',
        requestId,
      });
    }
  }

  const result = await generateMeetingSummary({ meetingId, userId: req.user.id, requestId });
  if (!result.ok) {
    const ELIGIBILITY_REASONS = new Set([
      'MEETING_TOO_SHORT',
      'INSUFFICIENT_PARTICIPANTS',
      'INSUFFICIENT_TRANSCRIPT',
      'MEETING_NOT_ENDED',
    ]);
    if (ELIGIBILITY_REASONS.has(result.reason)) {
      return res.status(422).json({
        error: true,
        reason: result.reason,
        message: meetingEligibilityMessage(result),
        requestId,
      });
    }
    // RATE_LIMITED / QUOTA_EXCEEDED (with reset info) / provider failures —
    // shared responder, same 429 shape as the chat routes.
    return aiFailureResponse(res, result, requestId);
  }
  res.status(200).json({
    summary: result.text || result.summary,
    cached: !!result.cached,
    requestId: result.requestId || requestId,
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
