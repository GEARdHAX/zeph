// Zeph AI — maps backend rejection `reason` codes (backend/src/ai/policy.js's
// REJECTION_REASONS, plus gateway-level GENERATION_IN_PROGRESS/INVALID_OUTPUT
// and route-level INPUT_TOO_LARGE) to a single user-facing sentence, so every
// AI action across the app explains failures consistently instead of each
// component inventing its own copy. Never mentions Gemini/Groq/providers/
// internal implementation — Phase 22's "do not reveal internal rate-limit/
// provider implementation details unnecessarily."
const MESSAGES = {
  AI_DISABLED: 'AI features are not available on this server right now.',
  PROVIDER_UNAVAILABLE: 'AI is temporarily unavailable. Please try again in a moment.',
  RATE_LIMITED: "You're using AI a bit fast — please wait a moment and try again.",
  QUOTA_EXCEEDED: "You've reached the AI usage limit. Please try again later.",
  GENERATION_IN_PROGRESS: 'This is already being generated — check back in a few seconds.',
  INVALID_OUTPUT: 'AI could not produce a usable result this time. Please try again.',
  INPUT_TOO_LARGE: 'That text is too long for this AI action.',
};

// Turn a `retryAfter` (seconds) / `resetAt` (ISO) from a 429 body into a
// human "come back" phrase. Short waits get a rounded seconds/minutes
// countdown; a wait that lands on/after the next local midnight is phrased
// as "tomorrow"; anything longer gives a clock time.
const formatComeBack = (retryAfter, resetAt) => {
  const seconds = Number.isFinite(retryAfter) ? retryAfter : null;
  if (seconds !== null && seconds <= 90) {
    const s = Math.max(5, Math.ceil(seconds / 5) * 5); // round up to the nearest 5s, floor 5
    return `Try again in about ${s} seconds.`;
  }
  if (seconds !== null && seconds <= 55 * 60) {
    return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  }
  // Longer wait — use the reset timestamp if we have it.
  const reset = resetAt ? new Date(resetAt) : (seconds !== null ? new Date(Date.now() + seconds * 1000) : null);
  if (!reset || Number.isNaN(reset.getTime())) return 'Please try again later.';
  const now = new Date();
  const tomorrowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (reset >= tomorrowMidnight) return 'The daily AI limit resets tomorrow.';
  const time = reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Try again after ${time}.`;
};

// eligibility failures (INSUFFICIENT_CONTEXT / MEETING_TOO_SHORT / etc.)
// carry their own precise message from the backend (e.g. "needs at least
// 100 messages") — prefer that verbatim. Quota failures (RATE_LIMITED /
// QUOTA_EXCEEDED) get a base sentence PLUS a concrete "come back in X" built
// from the 429 body's retryAfter/resetAt.
const ELIGIBILITY_REASONS = new Set([
  'INSUFFICIENT_CONTEXT', 'MEETING_TOO_SHORT', 'INSUFFICIENT_PARTICIPANTS',
  'INSUFFICIENT_TRANSCRIPT', 'MEETING_NOT_ENDED',
]);
const QUOTA_REASONS = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED']);

const getAiErrorMessage = (error) => {
  const data = error?.response?.data;
  const reason = data?.reason;

  if (ELIGIBILITY_REASONS.has(reason) && data?.message) return data.message;

  if (QUOTA_REASONS.has(reason)) {
    const base = MESSAGES[reason];
    const comeBack = formatComeBack(data?.retryAfter, data?.resetAt);
    return `${base} ${comeBack}`.trim();
  }

  if (reason && MESSAGES[reason]) return MESSAGES[reason];
  if (data?.message) return data.message;
  return 'Something went wrong. Please try again.';
};

export { getAiErrorMessage, MESSAGES, formatComeBack };
export default getAiErrorMessage;
