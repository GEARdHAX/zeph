// Zeph AI — Context Builder + Token Budget (Phase 6, hardened Phase 13).
// Never send unlimited history to the model. A crude chars/4 estimate (no
// tokenizer dependency — good enough to bound a request, not a
// billing-accurate count) enforces a hard input budget; output budget is
// enforced by the provider's max_tokens (see ai/provider.js's
// buildGroqProvider).
const estimateTokens = (text) => Math.ceil((text || '').length / 4);

// Phase 13 hardening: dropping whole messages from the front (below) cannot
// shrink a SINGLE oversized message — a caller sending one multi-megabyte
// "message" (translate/rewrite take raw client-supplied text with no
// separate length cap) would sail straight through the token-budget loop
// untouched, since messagesUsed never goes below 1. Every message's content
// is hard-truncated to this many characters BEFORE the budget loop runs, so
// the loop's per-message unit is always bounded regardless of how large the
// original input was. Sized generously above the token budget itself
// (aiMaxInputTokens*4 chars ~= the whole budget in one message) so this
// never clips a normal, budget-sized single message — it only catches
// genuinely oversized input.
const MAX_MESSAGE_CHARS = 20000;

// Builds bounded conversation text from an ALREADY-LIMITED message list
// (routes/ai/*.js caps the DB query itself — see summarize.js's .limit(200)
// — this is the second, content-based bound on top of that count-based one).
// Truncates from the front (drops oldest) so the most recent context —
// almost always what a summary/reply/title needs — survives the cut.
const buildBoundedContext = (messages, config = {}) => {
  const maxInputTokens = config.aiMaxInputTokens || 4000;
  const lines = messages.map((m) => {
    const content = (m.content || '').length > MAX_MESSAGE_CHARS
      ? `${m.content.slice(0, MAX_MESSAGE_CHARS)}...`
      : m.content;
    return `${m.author}: ${content}`;
  });

  let text = lines.join('\n');
  while (estimateTokens(text) > maxInputTokens && lines.length > 1) {
    lines.shift();
    text = lines.join('\n');
  }
  // Single-message case: still over budget after per-message truncation
  // (MAX_MESSAGE_CHARS is deliberately looser than the token budget) — hard
  // clip the final joined text itself as the last resort, so the provider
  // NEVER receives more than maxInputTokens*4 chars regardless of shape.
  const hardCapChars = maxInputTokens * 4;
  if (text.length > hardCapChars) text = text.slice(0, hardCapChars);

  return { text, inputTokenEstimate: estimateTokens(text), messagesUsed: lines.length };
};

module.exports = { buildBoundedContext, estimateTokens, MAX_MESSAGE_CHARS };
