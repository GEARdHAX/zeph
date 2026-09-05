// Zeph AI — centralized eligibility policy (Phase 4). Every "is this AI
// request worth making" threshold lives here, not scattered across route
// handlers, so tuning one number never means grepping the codebase.
//
// Machine-readable rejection reasons (returned by eligibility.js, consumed
// by routes/ai/*.js and the frontend) — one Set so a typo in a route handler
// throws instead of silently sending an unrecognized reason to the client.
const REJECTION_REASONS = Object.freeze({
  INSUFFICIENT_CONTEXT: 'INSUFFICIENT_CONTEXT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  AI_DISABLED: 'AI_DISABLED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  MEETING_TOO_SHORT: 'MEETING_TOO_SHORT',
  INSUFFICIENT_PARTICIPANTS: 'INSUFFICIENT_PARTICIPANTS',
  INSUFFICIENT_TRANSCRIPT: 'INSUFFICIENT_TRANSCRIPT',
  MEETING_NOT_ENDED: 'MEETING_NOT_ENDED',
});

// All portfolio-safe defaults, overridable via env (config.js) — see
// backend/.env.example's "Zeph AI" section. Deliberately stricter than
// Groq's own free-tier limits (see docs/ZEPH-AI-ARCHITECTURE.md's Cost
// Control section) — Zeph's own budget is a self-imposed ceiling, not a
// restatement of the provider's.
const buildPolicy = (config = {}) => ({
  groupSummary: { minMessages: config.aiPolicyGroupSummaryMinMessages ?? 100 },
  dmSummary: { minMessages: config.aiPolicyDmSummaryMinMessages ?? 30 },
  conversationTitle: { minMessages: config.aiPolicyTitleMinMessages ?? 5 },
  groupTopicExtraction: { minMessages: config.aiPolicyTopicMinMessages ?? 50 },
  // No conversation-size minimum for these three — the feature itself is
  // scoped small (a single message rewrite/translation, or a bounded
  // recent-context smart reply), so "not enough context yet" doesn't apply.
  smartReply: {},
  messageRewrite: {},
  translation: {},
  // Summary freshness (Phase 7): don't regenerate a cached summary for a
  // handful of new messages.
  summaryFreshness: { minNewMessages: config.aiPolicySummaryFreshnessMinNewMessages ?? 25 },
  // Meeting summary (Phase 14) — all three conditions must hold: real
  // duration (Meeting.endedAt - Meeting.startedAt), enough participants
  // (Meeting.users.length) to be worth summarizing, and enough actual
  // transcribed speech (not just a long-but-silent call).
  meetingSummary: {
    minDurationSeconds: config.aiPolicyMeetingSummaryMinDurationSeconds ?? 300,
    minParticipants: config.aiPolicyMeetingSummaryMinParticipants ?? 2,
    minTranscriptWords: config.aiPolicyMeetingSummaryMinTranscriptWords ?? 100,
  },
});

module.exports = { buildPolicy, REJECTION_REASONS };
