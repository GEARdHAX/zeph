const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Per-user "delete from my call history" state — same shape/reasoning as
// ConversationUserState: a Meeting can involve multiple participants with
// no single owner, so deleting it from history must only affect the
// requesting user's own list, never the other participant(s)'. No row =
// visible (the common case), a row is only created on explicit delete.
const MeetingUserStateSchema = new Schema({
  meeting: { type: Schema.ObjectId, ref: 'meetings', required: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  deletedAt: { type: Date, default: null },
});

MeetingUserStateSchema.index({ meeting: 1, user: 1 }, { unique: true });
MeetingUserStateSchema.index({ user: 1, deletedAt: 1 });

module.exports = mongoose.model('meetingUserStates', MeetingUserStateSchema);
