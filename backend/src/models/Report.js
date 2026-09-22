const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER'];
const STATUSES = ['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED'];

// A user-submitted report about another user, from inside a DM/group
// (TopBar.jsx's "Report" action). Deliberately its own collection, not a
// Relationship status flip like blocking — blocking is a single boolean
// state between two users, but the same reporter can file multiple reports
// against the same person over time (different incidents), and a report
// needs an admin review lifecycle blocking never had. `message` is optional:
// set when reporting a specific message (report button on a bubble, not
// built yet — this pass only wires the conversation-level "Report" menu
// item), null for a general "report this person" report.
const ReportSchema = new Schema({
  reporter: { type: Schema.ObjectId, ref: 'users', required: true },
  reportedUser: { type: Schema.ObjectId, ref: 'users', required: true },
  room: { type: Schema.ObjectId, ref: 'rooms', default: null },
  message: { type: Schema.ObjectId, ref: 'messages', default: null },
  reason: { type: String, enum: REASONS, required: true },
  // Free-text detail, capped at the route level (see routes/reports/create.js)
  // — never rendered as HTML anywhere, admin-only plain-text review.
  details: { type: String, default: '' },
  status: { type: String, enum: STATUSES, default: 'OPEN' },
  reviewedBy: { type: Schema.ObjectId, ref: 'users', default: null },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

// One open report per (reporter, reportedUser, room) at a time — resubmitting
// while an earlier report on the same person/conversation is still OPEN is a
// duplicate, not a second incident. A closed (REVIEWED/ACTIONED/DISMISSED)
// prior report doesn't block a fresh one, since that's a genuinely new
// incident an admin already finished reviewing.
ReportSchema.index({ reporter: 1, reportedUser: 1, room: 1, status: 1 });
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ reportedUser: 1, createdAt: -1 });

module.exports = mongoose.model('reports', ReportSchema);
module.exports.REASONS = REASONS;
module.exports.STATUSES = STATUSES;
