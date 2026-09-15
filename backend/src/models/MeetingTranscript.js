const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Zeph AI — Meeting AI (Phase 14). One document per meeting, holding the
// transcribed text (from Groq Whisper — see ai/provider.js's transcribe())
// and, once generated, the structured summary. Kept as its own collection
// (not embedded in Meeting.js) so transcript text — the most privacy-
// sensitive artifact this feature produces — has its own access pattern and
// can be deleted independently of the Meeting document itself.
//
// Privacy boundary: the RAW AUDIO recording (Media document, object
// storage) is deleted once transcription succeeds (see
// meetingTranscriptService.js) — only the text transcript persists here.
// This document itself is only ever read by meeting participants (enforced
// in routes/meeting/get-summary.js/summarize.js), same authorization
// boundary as the meeting itself.
//
// This IS the meeting-scoped canonical summary store (meeting-summary-
// persistence pass): the unique index on `meeting` below is the database-
// level guarantee that exactly one summary ever exists per meeting,
// regardless of how many participants request it or how many BullMQ jobs
// race to generate it — see meetingTranscriptService.js#generateMeetingSummary
// for the read-before-write cache check and ai/dedup.js's Redis lock for
// the concurrency-avoidance layer on top of that guarantee.
const MeetingTranscriptSchema = new Schema({
  meeting: {
    type: Schema.ObjectId,
    ref: 'meetings',
    required: true,
    unique: true,
  },
  transcript: { type: String, required: true },
  summary: { type: String, default: null },
  status: {
    type: String,
    enum: ['TRANSCRIBING', 'TRANSCRIBED', 'SUMMARIZING', 'SUMMARIZED', 'FAILED'],
    default: 'TRANSCRIBING',
  },
  failureReason: { type: String, default: null },
  // Which provider actually produced the summary ('gemini' | 'groq') —
  // providerRouter.generate() already returns this as `providerUsed`
  // (automatic-failover bookkeeping); persisted here purely for
  // observability/debugging, never surfaced to end users.
  summaryProvider: { type: String, default: null },
  generatedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('meeting_transcripts', MeetingTranscriptSchema);
