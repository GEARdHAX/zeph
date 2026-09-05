// Zeph AI — Eligibility Engine (Phase 4). Decides whether an AI request is
// worth making BEFORE any provider call — never "call the model, then decide
// it was pointless." All checks are O(1) index lookups (Message.countDocuments
// on the existing {room:1} index — see models/Message.js — never a full fetch
// scanned in application code, per Phase 18).
const Message = require('../models/Message');
const { REJECTION_REASONS } = require('./policy');

// conversationType comes from the caller (room.isGroup), not guessed here —
// keeps this module a pure function of its inputs, easy to unit test.
const checkSummaryEligibility = async (policy, roomId, conversationType) => {
  const minMessages = conversationType === 'group'
    ? policy.groupSummary.minMessages
    : policy.dmSummary.minMessages;

  const count = await Message.countDocuments({ room: roomId, type: 'text' });
  if (count < minMessages) {
    return { eligible: false, reason: REJECTION_REASONS.INSUFFICIENT_CONTEXT, minMessages, count };
  }
  return { eligible: true, count };
};

const checkTitleEligibility = async (policy, roomId) => {
  const count = await Message.countDocuments({ room: roomId, type: 'text' });
  if (count < policy.conversationTitle.minMessages) {
    return { eligible: false, reason: REJECTION_REASONS.INSUFFICIENT_CONTEXT, minMessages: policy.conversationTitle.minMessages, count };
  }
  return { eligible: true, count };
};

const checkTopicEligibility = async (policy, roomId) => {
  const count = await Message.countDocuments({ room: roomId, type: 'text' });
  if (count < policy.groupTopicExtraction.minMessages) {
    return { eligible: false, reason: REJECTION_REASONS.INSUFFICIENT_CONTEXT, minMessages: policy.groupTopicExtraction.minMessages, count };
  }
  return { eligible: true, count };
};

// No-op checks (smartReply/messageRewrite/translation have no size floor) —
// kept as real functions rather than skipped so every AI feature goes through
// the same gateway shape (see routes/ai/*.js), not a special-cased branch.
const checkAlwaysEligible = async () => ({ eligible: true });

// Freshness (Phase 7): given an existing cached summary's message count and
// the room's current count, decide whether regeneration is warranted.
const isSummaryStale = (policy, messageCountAtSummary, currentCount) => (
  currentCount - messageCountAtSummary >= policy.summaryFreshness.minNewMessages
);

// Meeting summary eligibility (Phase 14) — pure function of the Meeting
// document plus a word count (the caller supplies wordCount from the
// already-transcribed text; this module never re-transcribes to check
// eligibility, since eligibility must be checkable BEFORE any AI cost is
// incurred — see meetingTranscriptService.js's own ordering: duration/
// participant checks run before transcription is even requested).
const checkMeetingSummaryEligibility = (policy, meeting, transcriptWordCount) => {
  const { meetingSummary } = policy;

  if (!meeting.endedAt) {
    return { eligible: false, reason: 'MEETING_NOT_ENDED' };
  }

  const durationSeconds = (new Date(meeting.endedAt) - new Date(meeting.startedAt)) / 1000;
  if (durationSeconds < meetingSummary.minDurationSeconds) {
    return {
      eligible: false, reason: 'MEETING_TOO_SHORT', minDurationSeconds: meetingSummary.minDurationSeconds, durationSeconds,
    };
  }

  const participantCount = (meeting.users || []).length;
  if (participantCount < meetingSummary.minParticipants) {
    return {
      eligible: false, reason: 'INSUFFICIENT_PARTICIPANTS', minParticipants: meetingSummary.minParticipants, participantCount,
    };
  }

  if (typeof transcriptWordCount === 'number' && transcriptWordCount < meetingSummary.minTranscriptWords) {
    return {
      eligible: false, reason: 'INSUFFICIENT_TRANSCRIPT', minTranscriptWords: meetingSummary.minTranscriptWords, transcriptWordCount,
    };
  }

  return {
    eligible: true, durationSeconds, participantCount, transcriptWordCount,
  };
};

module.exports = {
  checkSummaryEligibility,
  checkTitleEligibility,
  checkTopicEligibility,
  checkAlwaysEligible,
  isSummaryStale,
  checkMeetingSummaryEligibility,
};
