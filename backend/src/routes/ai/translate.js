const store = require('../../store');
const { aiTextEnabled } = require('../../ai/providerRouter');
const { REJECTION_REASONS } = require('../../ai/policy');
const { boundText, MAX_MESSAGE_CHARS } = require('../../ai/contextBuilder');
const { runGoverned } = require('../../ai/gateway');
const { resolveRequestId, aiFailureResponse } = require('../../ai/telemetry');

// Zeph AI — POST /api/ai/translate. Client-supplied text only, no room
// access — no eligibility/membership check applies (same as before Zeph AI;
// see docs/AI-STRATEGY.md's original reasoning, preserved).
module.exports = async (req, res) => {
  const requestId = resolveRequestId(req);
  const { text, targetLanguage } = req.fields;
  if (!text || !targetLanguage) return res.status(400).json({ error: true, requestId });
  // Phase 13 hardening: reject oversized input BEFORE any context-building/
  // provider work — cheap, fails fast, and avoids ever handing a multi-MB
  // string to buildBoundedContext (which now also hard-caps as a second
  // line of defense, but rejecting here is cheaper and gives the client an
  // honest 413 instead of a silently truncated translation).
  if (text.length > MAX_MESSAGE_CHARS) {
    return res.status(413).json({
      error: true,
      reason: 'INPUT_TOO_LARGE',
      message: `Text is too long (max ${MAX_MESSAGE_CHARS} characters).`,
      requestId,
    });
  }

  const config = store.config;
  if (!aiTextEnabled(config)) {
    return res.status(503).json({
      error: true,
      reason: REJECTION_REASONS.AI_DISABLED,
      message: 'AI features are not enabled on this server.',
      requestId,
    });
  }

  const { text: bounded } = boundText(text, config);
  const prompt = `Translate the message below (delimited by triple backticks) to ${targetLanguage}. Reply with only the translation, no explanation, no quotes.\n\n\`\`\`\n${bounded}\n\`\`\``;

  const result = await runGoverned({
    userId: req.user.id,
    ip: req.ip,
    prompt,
    maxTokens: config.aiMaxOutputTokens || 800,
    metricsFeature: 'translation',
    requestId,
  });

  if (!result.ok) return aiFailureResponse(res, result, requestId);
  res.status(200).json({ translation: result.text, requestId: result.requestId });
};
