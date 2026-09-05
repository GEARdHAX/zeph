const store = require('../../store');
const { getProvider } = require('../../ai/provider');
const { REJECTION_REASONS } = require('../../ai/policy');
const { buildBoundedContext, MAX_MESSAGE_CHARS } = require('../../ai/contextBuilder');
const { runGoverned } = require('../../ai/gateway');
const { resolveRequestId } = require('../../ai/telemetry');

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
      error: true, reason: 'INPUT_TOO_LARGE', message: `Text is too long (max ${MAX_MESSAGE_CHARS} characters).`, requestId,
    });
  }

  const config = store.config;
  if (config.aiProvider === 'none' || !config.aiProvider || !getProvider(config).enabled) {
    return res.status(503).json({
      error: true, reason: REJECTION_REASONS.AI_DISABLED, message: 'AI features are not enabled on this server.', requestId,
    });
  }

  const { text: bounded } = buildBoundedContext([{ author: 'user', content: text }], config);
  const prompt = `Translate the following message to ${targetLanguage}. Reply with only the translation, no explanation.\n\nMessage: ${bounded}\n\nTranslation:`;

  const result = await runGoverned({
    userId: req.user.id,
    ip: req.ip,
    prompt,
    maxTokens: config.aiMaxOutputTokens || 800,
    metricsFeature: 'translation',
    requestId,
  });

  if (!result.ok) {
    const status = result.reason === REJECTION_REASONS.RATE_LIMITED || result.reason === REJECTION_REASONS.QUOTA_EXCEEDED ? 429 : 502;
    return res.status(status).json({
      error: true, reason: result.reason, message: 'AI provider request failed.', requestId: result.requestId,
    });
  }
  res.status(200).json({ translation: result.text, requestId: result.requestId });
};
