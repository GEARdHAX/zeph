const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
  author: { type: Schema.ObjectId, ref: 'users' },
  content: String,
  type: String,
  file: { type: Schema.ObjectId, ref: 'files' },
  room: { type: Schema.ObjectId, ref: 'rooms' },
  date: {
    type: Date,
    default: Date.now,
  },
  readBy: [{ type: Schema.ObjectId, ref: 'users' }],
});

// Every message list/pagination/sync query filters by room first, then ranges on _id
// (already indexed as the primary key) — a single index on room covers all of them.
MessageSchema.index({ room: 1 });

module.exports = User = mongoose.model('messages', MessageSchema);
