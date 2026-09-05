// Zeph AI — Output Validation (Phase 12). Treat model output as untrusted
// external input: bounded length, non-empty, string type. No structured/JSON
// schema needed for these features (summary/translation/title/etc. are all
// plain text) — a length + type + non-empty check is the whole contract, so
// that's the whole validator (Phase 12 asks for validation, not a specific
// mechanism; a hand-rolled JSON-schema layer here would be governing nothing
// the model actually returns as structured data).
const MAX_OUTPUT_CHARS = 4000; // generous vs. config.aiMaxOutputTokens' ~800-1000 tokens; this is a hard safety ceiling, not the primary budget

const validateTextOutput = (text) => {
  if (typeof text !== 'string') return { ok: false, reason: 'not_a_string' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'empty_output' };
  if (trimmed.length > MAX_OUTPUT_CHARS) return { ok: false, reason: 'output_too_long' };
  return { ok: true, text: trimmed };
};

module.exports = { validateTextOutput, MAX_OUTPUT_CHARS };
