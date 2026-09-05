const Room = require('../../models/Room');
const store = require('../../store');
const { getProvider } = require('../../ai/provider');
const { REJECTION_REASONS } = require('../../ai/policy');
const { buildBoundedContext } = require('../../ai/contextBuilder');
const { runGoverned } = require('../../ai/gateway');
const { fetchRecentMessages } = require('../../ai/summaryService');
const Message = require('../../models/Message');
const { resolveRequestId } = require('../../ai/telemetry');

// Zeph AI — POST /api/ai/draft-reply (also serves as "smart reply", Phase 20
// P1 — same shape: bounded recent context, no conversation-size minimum per
// policy.js's smartReply entry).
module.exports = async (req, res) => {
  const requestId = resolveRequestId(req);
  const { roomID } = req.fields;
  if (!roomID) return res.status(400).json({ error: true, requestId });

  const config = store.config;
  if (config.aiProvider === 'none' || !config.aiProvider || !getProvider(config).enabled) {
    return res.status(503).json({
      error: true, reason: REJECTION_REASONS.AI_DISABLED, message: 'AI features are not enabled on this server.', requestId,
    });
  }

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return res.status(404).json({ error: true, requestId });
  }
  if (!room) return res.status(404).json({ error: true, requestId });

  const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
  if (!isMember) return res.status(403).json({ error: true, requestId });

  const messages = (await Message.find({ room: roomID, type: 'text' })
    .sort({ _id: -1 })
    .limit(20)
    .populate({ path: 'author', select: 'firstName' })
    .lean())
    .reverse()
    .map((m) => ({ author: m.author ? m.author.firstName : 'Deleted User', content: m.content }));

  if (!messages.length) {
    return res.status(422).json({
      error: true, reason: 'INSUFFICIENT_CONTEXT', message: 'No messages yet to draft a reply from.', requestId,
    });
  }

  const { text: bounded } = buildBoundedContext(messages, config);
  const prompt = `Based on this conversation, draft a short, natural reply the user could send next. Reply with only the draft message, no explanation.\n\n${bounded}\n\nDraft reply:`;

  const result = await runGoverned({
    userId: req.user.id,
    ip: req.ip,
    prompt,
    maxTokens: config.aiMaxOutputTokens || 800,
    metricsFeature: 'draft_reply',
    requestId,
    scope: room.isGroup ? 'group' : 'dm',
  });

  if (!result.ok) {
    const status = result.reason === REJECTION_REASONS.RATE_LIMITED || result.reason === REJECTION_REASONS.QUOTA_EXCEEDED ? 429 : 502;
    return res.status(status).json({
      error: true, reason: result.reason, message: 'AI provider request failed.', requestId: result.requestId,
    });
  }
  res.status(200).json({ draft: result.text, requestId: result.requestId });
};
