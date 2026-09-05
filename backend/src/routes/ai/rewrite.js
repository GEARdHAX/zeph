const store = require('../../store');
const { getProvider } = require('../../ai/provider');
const { REJECTION_REASONS } = require('../../ai/policy');
const { buildBoundedContext, MAX_MESSAGE_CHARS } = require('../../ai/contextBuilder');
const { runGoverned } = require('../../ai/gateway');
const { resolveRequestId } = require('../../ai/telemetry');

// Zeph AI — POST /api/ai/rewrite (Phase 20, P0). Client-supplied text only,
// same shape as translate.js — no conversation-size minimum, no room access.
module.exports = async (req, res) => {
  const requestId = resolveRequestId(req);
  const { text, tone } = req.fields;
  if (!text) return res.status(400).json({ error: true, requestId });
  // Phase 13 hardening — see translate.js's identical guard for rationale.
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
  const toneInstruction = tone ? ` in a ${tone} tone` : '';
  const prompt = `Rewrite the following message${toneInstruction}, keeping the same meaning. Reply with only the rewritten message, no explanation.\n\nMessage: ${bounded}\n\nRewritten:`;

  const result = await runGoverned({
    userId: req.user.id,
    ip: req.ip,
    prompt,
    maxTokens: config.aiMaxOutputTokens || 800,
    metricsFeature: 'message_rewrite',
    requestId,
  });

  if (!result.ok) {
    const status = result.reason === REJECTION_REASONS.RATE_LIMITED || result.reason === REJECTION_REASONS.QUOTA_EXCEEDED ? 429 : 502;
    return res.status(status).json({
      error: true, reason: result.reason, message: 'AI provider request failed.', requestId: result.requestId,
    });
  }
  res.status(200).json({ rewritten: result.text, requestId: result.requestId });
};
