const Room = require('../../models/Room');
const ConversationSummary = require('../../models/ConversationSummary');
const store = require('../../store');
const { getProvider } = require('../../ai/provider');
const { buildPolicy, REJECTION_REASONS } = require('../../ai/policy');
const { checkSummaryEligibility, isSummaryStale } = require('../../ai/eligibility');
const { generateAndPersistSummary } = require('../../ai/summaryService');
const { enqueueSummaryJob, getQueue } = require('../../queues/aiQueue');
const {
  logEligibilityRejected, logCacheHit, logQueued, resolveRequestId,
} = require('../../ai/telemetry');

// Zeph AI — POST /api/ai/summarize (Phases 3-9). Gateway entry point:
// authenticate (passport, in routes/index.js) -> authorize (room membership)
// -> eligibility -> freshness/cache -> generate (queued if BullMQ is
// available, synchronous fallback otherwise — Phase 9 explicitly allows
// synchronous execution when the architecture doesn't have a worker running).
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

  const policy = buildPolicy(config);
  const conversationType = room.isGroup ? 'group' : 'dm';
  const eligibility = await checkSummaryEligibility(policy, roomID, conversationType);
  if (!eligibility.eligible) {
    logEligibilityRejected({
      requestId, feature: 'conversation_summary', scope: conversationType, reason: eligibility.reason, minMessages: eligibility.minMessages, count: eligibility.count,
    });
    return res.status(422).json({
      error: true,
      reason: eligibility.reason,
      message: `Not enough conversation yet. Zeph needs at least ${eligibility.minMessages} messages to generate a useful ${conversationType === 'group' ? 'group' : 'conversation'} summary.`,
      requestId,
    });
  }

  // Freshness (Phase 7): reuse a cached summary unless enough new messages
  // have accumulated since it was generated.
  const existing = await ConversationSummary.findOne({ room: roomID }).lean();
  if (existing && !isSummaryStale(policy, existing.messageCountAtSummary, eligibility.count)) {
    logCacheHit({
      requestId, feature: 'conversation_summary', scope: conversationType, messageCountAtSummary: existing.messageCountAtSummary, currentCount: eligibility.count,
    });
    return res.status(200).json({ summary: existing.summary, cached: true, requestId });
  }

  // Expensive path — prefer BullMQ (Phase 9) when a worker can pick it up;
  // synchronous generation is the fallback so this endpoint still works
  // without Redis (same "degrade, don't break" posture as every other
  // Redis-optional Zeph feature).
  if (getQueue()) {
    await enqueueSummaryJob({
      roomId: roomID, conversationType, userId: req.user.id, messageCountAtSummary: eligibility.count, requestId,
    });
    logQueued({ requestId, feature: 'conversation_summary', scope: conversationType });
    return res.status(202).json({
      status: 'GENERATING',
      message: 'Summary is being generated. Check back shortly, or reuse the previous summary if one exists.',
      previousSummary: existing?.summary || null,
      requestId,
    });
  }

  const result = await generateAndPersistSummary({
    roomId: roomID, userId: req.user.id, ip: req.ip, currentMessageCount: eligibility.count, requestId, scope: conversationType,
  });
  if (!result.ok) {
    const status = result.reason === REJECTION_REASONS.RATE_LIMITED || result.reason === REJECTION_REASONS.QUOTA_EXCEEDED ? 429 : 502;
    return res.status(status).json({
      error: true, reason: result.reason, message: 'AI provider request failed.', requestId: result.requestId || requestId,
    });
  }
  res.status(200).json({
    summary: result.text, cached: false, requestId: result.requestId || requestId,
  });
};
