const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Queryable moderation history, additive to (not a replacement for) the
// existing pino logger.info/warn calls in these same routes — this is the
// in-app audit trail; pino is the operational log. See DECISIONS.md.
const GroupAuditLogSchema = new Schema({
  group: { type: Schema.ObjectId, ref: 'rooms', required: true },
  actor: { type: Schema.ObjectId, ref: 'users', required: true },
  action: { type: String, required: true },
  target: { type: Schema.ObjectId, ref: 'users', default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

GroupAuditLogSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model('groupAuditLogs', GroupAuditLogSchema);
