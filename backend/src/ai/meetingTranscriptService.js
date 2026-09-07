// Zeph AI — Meeting AI business logic (Phase 14). Pipeline: fetch recorded
// audio (Media/storage.js) -> transcribe -> persist transcript -> delete raw
// audio (privacy: only text persists) -> eligibility check -> chunk + bound
// transcript -> generate summary (existing ai/gateway.js pipeline, same
// governance every other Zeph AI feature gets) -> persist + validate.
//
// Transcription provider: Gemini's multimodal model (inline audio) when
// AI_PROVIDER=gemini, else Groq Whisper. Only ONE is used per call — no
// automatic failover for transcription (a large audio upload retried on a
// second provider doubles bandwidth + latency for a one-time operation; the
// user can just retry). The chat-summary step DOES get failover, via
// runGoverned -> providerRouter.
const store = require('../store');
const logger = require('../logger');
const Meeting = require('../models/Meeting');
const MeetingTranscript = require('../models/MeetingTranscript');
const Media = require('../models/Media');
const storage = require('../storage');
const { getProvider, buildGroqFallback } = require('./provider');
const { buildPolicy } = require('./policy');
const { checkMeetingSummaryEligibility } = require('./eligibility');
const { boundText } = require('./contextBuilder');
const { runGoverned } = require('./gateway');

const countWords = (text) => (text || '').trim().split(/\s+/).filter(Boolean).length;

// The provider to use for transcription: the configured primary if it can
// transcribe (gemini/groq both can), else a Groq fallback if a key exists.
// null => transcription is not available on this deployment.
const getTranscriptionProvider = (config) => {
  const primary = getProvider(config);
  if (primary.enabled && typeof primary.transcribe === 'function') {
    // ollama's transcribe() throws — treat "has a real STT" as gemini/groq only.
    if (config.aiProvider === 'gemini' || config.aiProvider === 'groq') return primary;
  }
  return buildGroqFallback(config); // may be null
};

// Transcription itself is not run through ai/gateway.js's quota/dedup
// pipeline — it's a one-time, per-meeting operation triggered by an explicit
// user action. It IS still bounded (25MB file limit, matched by
// mediaPolicy's audio.maxSize) and fails closed if no STT provider is set.
const transcribeMeetingAudio = async ({ meetingId, mediaId, userId }) => {
  const config = store.config || {};
  const provider = getTranscriptionProvider(config);
  if (!provider) {
    return { ok: false, reason: 'AI_DISABLED' };
  }

  const media = await Media.findOne({ _id: mediaId, uploaderId: userId, category: 'audio', status: 'READY' });
  if (!media) return { ok: false, reason: 'MEDIA_NOT_FOUND' };

  const transcriptDoc = await MeetingTranscript.findOneAndUpdate(
    { meeting: meetingId },
    {
      meeting: meetingId, status: 'TRANSCRIBING', updatedAt: new Date(),
    },
    { upsert: true, setDefaultsOnInsert: true, new: true },
  );

  let audioBuffer;
  try {
    const stream = await storage.getObjectStream(media.storageKey);
    const chunks = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of stream) chunks.push(chunk);
    audioBuffer = Buffer.concat(chunks);
  } catch (err) {
    logger.error({ err, meetingId, mediaId }, 'meeting_ai_audio_fetch_failed');
    await MeetingTranscript.updateOne({ meeting: meetingId }, { status: 'FAILED', failureReason: 'AUDIO_FETCH_FAILED', updatedAt: new Date() });
    return { ok: false, reason: 'AUDIO_FETCH_FAILED' };
  }

  let transcriptText;
  try {
    transcriptText = await provider.transcribe(audioBuffer, media.originalName || 'audio.webm');
  } catch (err) {
    const reason = err.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'TRANSCRIPTION_FAILED';
    logger.warn({ err: err.message, meetingId }, 'meeting_ai_transcription_failed');
    await MeetingTranscript.updateOne({ meeting: meetingId }, { status: 'FAILED', failureReason: reason, updatedAt: new Date() });
    return { ok: false, reason };
  }

  transcriptDoc.transcript = transcriptText;
  transcriptDoc.status = 'TRANSCRIBED';
  transcriptDoc.updatedAt = new Date();
  await transcriptDoc.save();

  // Privacy (Phase 11 of the original Zeph AI spec, section reused here):
  // the raw audio recording is deleted once transcription succeeds — only
  // the text transcript persists. Best-effort; a failed delete doesn't fail
  // the whole operation (an orphaned Media row is a storage-cost concern,
  // not a correctness one — same posture as other cleanup-after-success
  // steps in this codebase, e.g. upload-media-complete.js's temp file unlink).
  await storage.deleteObject(media.storageKey).catch((err) => logger.warn({ err, mediaId }, 'meeting_ai_audio_cleanup_failed'));
  await Media.deleteOne({ _id: mediaId }).catch(() => {});

  logger.info({ meetingId, wordCount: countWords(transcriptText) }, 'meeting_ai_transcribed');
  return { ok: true, transcript: transcriptText };
};

// Returns { ok, reason?, minX? } (eligibility shape) or { ok:true, summary }.
const generateMeetingSummary = async ({ meetingId, userId, requestId }) => {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) return { ok: false, reason: 'MEETING_NOT_FOUND' };

  const transcriptDoc = await MeetingTranscript.findOne({ meeting: meetingId });
  if (!transcriptDoc || !transcriptDoc.transcript) {
    return { ok: false, reason: 'INSUFFICIENT_TRANSCRIPT', minTranscriptWords: buildPolicy(store.config).meetingSummary.minTranscriptWords, transcriptWordCount: 0 };
  }

  const policy = buildPolicy(store.config);
  const wordCount = countWords(transcriptDoc.transcript);
  const eligibility = checkMeetingSummaryEligibility(policy, meeting, wordCount);
  if (!eligibility.eligible) return { ok: false, ...eligibility };

  if (transcriptDoc.summary && transcriptDoc.status === 'SUMMARIZED') {
    return { ok: true, summary: transcriptDoc.summary, cached: true };
  }

  await MeetingTranscript.updateOne({ meeting: meetingId }, { status: 'SUMMARIZING', updatedAt: new Date() });

  // Chunking long transcripts (Phase 14 requirement): boundText truncates
  // the transcript to the token budget (a meeting transcript is linear
  // speech, not a multi-party message list, so one bounded block is the
  // right shape — a real multi-pass hierarchical summarizer is future work
  // if transcripts routinely exceed the budget, same "don't build it
  // speculatively" call as ai/summaryService.js's own note).
  const { text: boundedTranscript } = boundText(transcriptDoc.transcript, store.config);
  const prompt = `Summarize the meeting transcript below (delimited by triple backticks) in 3-5 sentences, focusing on decisions made and action items. Be concise and neutral. Reply with only the summary.\n\n\`\`\`\n${boundedTranscript}\n\`\`\``;

  const result = await runGoverned({
    userId,
    ip: 'meeting',
    prompt,
    dedupeKey: `meeting-summary:${meetingId}`,
    maxTokens: store.config?.aiMaxOutputTokens || 800,
    metricsFeature: 'meeting_summary',
    requestId,
    scope: 'meeting',
  });

  if (!result.ok) {
    await MeetingTranscript.updateOne({ meeting: meetingId }, { status: 'TRANSCRIBED', updatedAt: new Date() }); // revert — still has a usable transcript, just no summary yet
    return result;
  }

  await MeetingTranscript.updateOne(
    { meeting: meetingId },
    {
      summary: result.text, status: 'SUMMARIZED', updatedAt: new Date(),
    },
  );

  return {
    ok: true, summary: result.text, cached: false, requestId: result.requestId,
  };
};

module.exports = { transcribeMeetingAudio, generateMeetingSummary, countWords };
