const store = require('../../store');
const { aiTextEnabled } = require('../../ai/providerRouter');
const { REJECTION_REASONS } = require('../../ai/policy');
const { boundText, MAX_MESSAGE_CHARS } = require('../../ai/contextBuilder');
const { runGoverned } = require('../../ai/gateway');
const { resolveRequestId, aiFailureResponse } = require('../../ai/telemetry');

// Zeph AI — POST /api/ai/rewrite (Phase 20, P0). Client-supplied text only,
// same shape as translate.js — no conversation-size minimum, no room access.
module.exports = async (req, res) => {
  const requestId = resolveRequestId(req);
  const { text, tone } = req.fields;
  if (!text) return res.status(400).json({ error: true, requestId });
  // Phase 13 hardening — see translate.js's identical guard for rationale.
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
  const toneInstruction = tone ? ` in a ${tone} tone` : '';
  const prompt = `Rewrite the message below (delimited by triple backticks)${toneInstruction}, keeping the same meaning. Reply with only the rewritten message, no explanation, no quotes.\n\n\`\`\`\n${bounded}\n\`\`\``;

  const result = await runGoverned({
    userId: req.user.id,
    ip: req.ip,
    prompt,
    maxTokens: config.aiMaxOutputTokens || 800,
    metricsFeature: 'message_rewrite',
    requestId,
  });

  if (!result.ok) return aiFailureResponse(res, result, requestId);
  res.status(200).json({ rewritten: result.text, requestId: result.requestId });
};
