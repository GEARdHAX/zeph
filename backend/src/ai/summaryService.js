// Zeph AI — conversation summary business logic (Phases 6, 7, 9, 10). Shared
// by the synchronous fallback in routes/ai/summarize.js (no Redis/BullMQ
// configured — see that file) and queues/aiWorker.js (Redis configured).
//
// "Hierarchical/incremental summarization" (Phase 10) stays intentionally
// simple here: the context builder already caps input to the most recent
// N messages within the token budget (Phase 6) — for a portfolio-scale
// conversation that bound alone keeps the summary useful without a separate
// multi-pass pipeline. A true incremental-chunk-then-merge pipeline is real
// future work if a conversation's HISTORY (not just its current tail)
// genuinely needs summarizing — not built speculatively here.
const Message = require('../models/Message');
const ConversationSummary = require('../models/ConversationSummary');
const { buildBoundedContext } = require('./contextBuilder');
const { runGoverned } = require('./gateway');
const store = require('../store');

// Capped at 200 — bounds the DB read itself (Phase 18: "only retrieve the
// content required"); the context builder then further trims to the token
// budget on top of this count-based cap.
const MAX_MESSAGES_FOR_SUMMARY = 200;

const fetchRecentMessages = async (roomId) => {
  const messages = await Message.find({ room: roomId, type: 'text' })
    .sort({ _id: -1 })
    .limit(MAX_MESSAGES_FOR_SUMMARY)
    .select('author content')
    .populate({ path: 'author', select: 'firstName' })
    .lean();
  messages.reverse();
  return messages.map((m) => ({ author: m.author ? m.author.firstName : 'Deleted User', content: m.content }));
};

// Returns { ok, text?, reason? } — never throws; callers (route or worker)
// decide what to do with a rejection.
const generateAndPersistSummary = async ({
  roomId, userId, ip, currentMessageCount, requestId, scope,
}) => {
  const messages = await fetchRecentMessages(roomId);
  if (!messages.length) return { ok: false, reason: 'INSUFFICIENT_CONTEXT' };

  const { text: contextText } = buildBoundedContext(messages, store.config);
  const prompt = `Summarize this chat conversation in 2-3 sentences. Be concise and neutral.\n\n${contextText}\n\nSummary:`;

  const result = await runGoverned({
    userId,
    ip,
    prompt,
    dedupeKey: `summary:${roomId}:${currentMessageCount}`,
    maxTokens: store.config?.aiMaxOutputTokens || 800,
    metricsFeature: 'conversation_summary',
    requestId,
    scope,
  });

  if (!result.ok) return result;

  await ConversationSummary.findOneAndUpdate(
    { room: roomId },
    {
      room: roomId,
      messageCountAtSummary: currentMessageCount,
      summary: result.text,
      updatedAt: new Date(),
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return { ok: true, text: result.text, cached: false };
};

module.exports = { generateAndPersistSummary, fetchRecentMessages, MAX_MESSAGES_FOR_SUMMARY };
