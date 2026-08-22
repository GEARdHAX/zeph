const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
  author: { type: Schema.ObjectId, ref: 'users' },
  content: String,
  type: String,
  file: { type: Schema.ObjectId, ref: 'files' },
  // Generalized attachment ref, used by every NEW media message going
  // forward (image/video/audio/pdf/document/archive/text, all uploaded via
  // upload-media.js into the unified Media collection) — `file` above stays
  // exactly as-is for existing/legacy file messages. Additive, not a
  // migration; a message never has both set. See mediaPolicy.js.
  media: { type: Schema.ObjectId, ref: 'media' },
  room: { type: Schema.ObjectId, ref: 'rooms' },
  date: {
    type: Date,
    default: Date.now,
  },
  readBy: [{ type: Schema.ObjectId, ref: 'users' }],
  // Sent (row exists) -> delivered (recipient's client acked receipt) -> read
  // (readBy above). Same array-of-ObjectId shape as readBy, reused rather
  // than a new watermark model — at this conversation scale a per-message
  // array is simpler than tracking a separate high-water-mark field per room.
  deliveredTo: [{ type: Schema.ObjectId, ref: 'users' }],
  // "Delete for everyone" is a tombstone, not a physical delete — the row
  // (and its ordering/pagination/reply position) stays put; only the content
  // is hidden. Kept separate from `deletedFor` below: deletedForEveryone is
  // a single global flag the author sets once, deletedFor is a per-viewer
  // "delete for me" list — same array-of-ObjectId shape already established
  // by `readBy`, so it reuses that pattern rather than inventing a new one.
  deletedForEveryone: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedFor: [{ type: Schema.ObjectId, ref: 'users' }],
});

// Every message list/pagination/sync query filters by room first, then ranges on _id
// (already indexed as the primary key) — a single index on room covers all of them.
MessageSchema.index({ room: 1 });

// Strips the real content once a message is tombstoned, applied wherever a
// Message document is serialized to JSON (res.json(), Socket.IO's own
// JSON-serializing emit) — a single choke point instead of every route
// remembering to check deletedForEveryone before sending content over the
// wire. `.lean()` queries bypass this (see routes/more-messages.js and
// sync-messages.js, which already do their own explicit stripping).
MessageSchema.set('toJSON', {
  transform: (doc, ret) => {
    if (ret.deletedForEveryone) {
      ret.content = null;
      ret.file = null;
      ret.media = null;
    }
    return ret;
  },
});

module.exports = User = mongoose.model('messages', MessageSchema);
