const Room = require('../../models/Room');
const Message = require('../../models/Message');
const store = require('../../store');
const { getProvider } = require('../../ai/provider');
const { buildPolicy, REJECTION_REASONS } = require('../../ai/policy');
const { checkTitleEligibility } = require('../../ai/eligibility');
const { buildBoundedContext } = require('../../ai/contextBuilder');
const { runGoverned } = require('../../ai/gateway');
const { logEligibilityRejected, resolveRequestId } = require('../../ai/telemetry');

// Zeph AI — POST /api/ai/title (Phase 20, P1). Suggests a conversation
// title; does not write it — the caller (frontend) applies it via the
// existing room-rename flow, same "AI is advisory, never an authorization
// authority" boundary as every other Zeph AI feature (Phase 11/12).
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

  const scope = room.isGroup ? 'group' : 'dm';
  const policy = buildPolicy(config);
  const eligibility = await checkTitleEligibility(policy, roomID);
  if (!eligibility.eligible) {
    logEligibilityRejected({
      requestId, feature: 'conversation_title', scope, reason: eligibility.reason, minMessages: eligibility.minMessages, count: eligibility.count,
    });
    return res.status(422).json({
      error: true,
      reason: eligibility.reason,
      message: `Not enough conversation yet. Zeph needs at least ${eligibility.minMessages} messages to suggest a title.`,
      requestId,
    });
  }

  const messages = (await Message.find({ room: roomID, type: 'text' })
    .sort({ _id: -1 })
    .limit(50)
    .populate({ path: 'author', select: 'firstName' })
    .lean())
    .reverse()
    .map((m) => ({ author: m.author ? m.author.firstName : 'Deleted User', content: m.content }));

  const { text: bounded } = buildBoundedContext(messages, config);
  const prompt = `Suggest a short conversation title (max 6 words) that captures what this conversation is about. Reply with only the title, no quotes, no explanation.\n\n${bounded}\n\nTitle:`;

  const result = await runGoverned({
    userId: req.user.id,
    ip: req.ip,
    prompt,
    dedupeKey: `title:${roomID}:${eligibility.count}`,
    maxTokens: 30,
    metricsFeature: 'conversation_title',
    requestId,
    scope,
  });

  if (!result.ok) {
    const status = result.reason === REJECTION_REASONS.RATE_LIMITED || result.reason === REJECTION_REASONS.QUOTA_EXCEEDED ? 429 : 502;
    return res.status(status).json({
      error: true, reason: result.reason, message: 'AI provider request failed.', requestId: result.requestId,
    });
  }
  res.status(200).json({ title: result.text, requestId: result.requestId });
};
