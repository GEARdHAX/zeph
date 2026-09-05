const Room = require('../../models/Room');
const Message = require('../../models/Message');
const store = require('../../store');
const { getProvider } = require('../../ai/provider');
const { buildPolicy, REJECTION_REASONS } = require('../../ai/policy');
const { checkTopicEligibility } = require('../../ai/eligibility');
const { buildBoundedContext } = require('../../ai/contextBuilder');
const { runGoverned } = require('../../ai/gateway');
const { logEligibilityRejected, resolveRequestId } = require('../../ai/telemetry');

// Zeph AI — POST /api/ai/topics (Phase 20, P1). Group topic extraction —
// group rooms only, same eligibility/dedupe shape as title.js.
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
  if (!room.isGroup) return res.status(400).json({ error: true, message: 'Topic extraction is only available for groups.', requestId });

  const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
  if (!isMember) return res.status(403).json({ error: true, requestId });

  const policy = buildPolicy(config);
  const eligibility = await checkTopicEligibility(policy, roomID);
  if (!eligibility.eligible) {
    logEligibilityRejected({
      requestId, feature: 'group_topic_extraction', scope: 'group', reason: eligibility.reason, minMessages: eligibility.minMessages, count: eligibility.count,
    });
    return res.status(422).json({
      error: true,
      reason: eligibility.reason,
      message: `Not enough conversation yet. Zeph needs at least ${eligibility.minMessages} messages to extract topics.`,
      requestId,
    });
  }

  const messages = (await Message.find({ room: roomID, type: 'text' })
    .sort({ _id: -1 })
    .limit(200)
    .populate({ path: 'author', select: 'firstName' })
    .lean())
    .reverse()
    .map((m) => ({ author: m.author ? m.author.firstName : 'Deleted User', content: m.content }));

  const { text: bounded } = buildBoundedContext(messages, config);
  const prompt = `List the main topics discussed in this conversation as a short comma-separated list (max 5 topics). Reply with only the list, no explanation.\n\n${bounded}\n\nTopics:`;

  const result = await runGoverned({
    userId: req.user.id,
    ip: req.ip,
    prompt,
    dedupeKey: `topics:${roomID}:${eligibility.count}`,
    maxTokens: 60,
    metricsFeature: 'group_topic_extraction',
    requestId,
    scope: 'group',
  });

  if (!result.ok) {
    const status = result.reason === REJECTION_REASONS.RATE_LIMITED || result.reason === REJECTION_REASONS.QUOTA_EXCEEDED ? 429 : 502;
    return res.status(status).json({
      error: true, reason: result.reason, message: 'AI provider request failed.', requestId: result.requestId,
    });
  }
  res.status(200).json({ topics: result.text.split(',').map((t) => t.trim()).filter(Boolean), requestId: result.requestId });
};
