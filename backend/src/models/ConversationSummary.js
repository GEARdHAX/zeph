const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Zeph AI — durable summary cache (Phase 7). One document per room, replaced
// (not appended) on regeneration — freshness is enforced by comparing
// messageCountAtSummary against the room's current message count
// (ai/eligibility.js's isSummaryStale), not by keeping a history.
const ConversationSummarySchema = new Schema({
  room: { type: Schema.ObjectId, ref: 'rooms', required: true, unique: true },
  lastSummarizedMessageId: { type: Schema.ObjectId, ref: 'messages' },
  messageCountAtSummary: { type: Number, required: true },
  summary: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('conversation_summaries', ConversationSummarySchema);
