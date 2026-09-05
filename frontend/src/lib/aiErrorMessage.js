// Zeph AI — maps backend rejection `reason` codes (backend/src/ai/policy.js's
// REJECTION_REASONS, plus gateway-level GENERATION_IN_PROGRESS/INVALID_OUTPUT
// and route-level INPUT_TOO_LARGE) to a single user-facing sentence, so every
// AI action across the app explains failures consistently instead of each
// component inventing its own copy. Never mentions Groq/providers/internal
// implementation — Phase 22's "do not reveal internal rate-limit/provider
// implementation details unnecessarily."
const MESSAGES = {
  AI_DISABLED: 'AI features are not available on this server right now.',
  PROVIDER_UNAVAILABLE: "AI is temporarily unavailable. Please try again in a moment.",
  RATE_LIMITED: "You're using AI a bit fast — please wait a moment and try again.",
  QUOTA_EXCEEDED: "You've reached today's AI usage limit. Please try again tomorrow.",
  GENERATION_IN_PROGRESS: 'This is already being generated — check back in a few seconds.',
  INVALID_OUTPUT: 'AI could not produce a usable result this time. Please try again.',
  INPUT_TOO_LARGE: 'That text is too long for this AI action.',
};

// eligibility failures (INSUFFICIENT_CONTEXT) carry their own precise
// message from the backend (e.g. "needs at least 100 messages") — prefer
// that verbatim when present, since it already states the exact threshold;
// only fall back to a generic sentence if the backend didn't supply one.
const getAiErrorMessage = (error) => {
  const data = error?.response?.data;
  const reason = data?.reason;
  if (reason === 'INSUFFICIENT_CONTEXT' && data?.message) return data.message;
  if (reason && MESSAGES[reason]) return MESSAGES[reason];
  if (data?.message) return data.message;
  return 'Something went wrong. Please try again.';
};

export { getAiErrorMessage, MESSAGES };
export default getAiErrorMessage;
