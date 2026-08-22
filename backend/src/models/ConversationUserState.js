const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

// Per-user visibility state for a conversation — deliberately a separate
// collection rather than an array field on Room, since two independent
// booleans (hidden, deleted) per (user, conversation) pair are a natural
// row, not a room-level list. No row = normal/visible, the common case, so
// rows are only ever created lazily on first hide/delete rather than one per
// user per room up front.
const ConversationUserStateSchema = new Schema({
  conversation: { type: Schema.ObjectId, ref: 'rooms', required: true },
  user: { type: Schema.ObjectId, ref: 'users', required: true },
  isHidden: { type: Boolean, default: false },
  hiddenAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  // Cursor marking WHEN this user last deleted this conversation. Messages
  // with `date <= deletedBefore` are hidden from this user's view even
  // after the conversation is restored by new activity (which clears
  // deletedAt but NOT this) — this is what makes "Delete DM" non-self-
  // reversing in content, not just in list-visibility. See message.js's
  // reappearance logic and DECISIONS.md.
  deletedBefore: { type: Date, default: null },
});

ConversationUserStateSchema.index({ conversation: 1, user: 1 }, { unique: true });
ConversationUserStateSchema.index({ user: 1, isHidden: 1 });
ConversationUserStateSchema.index({ user: 1, deletedAt: 1 });

module.exports = mongoose.model('conversationUserStates', ConversationUserStateSchema);
