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
  // Phase 8: client-generated UUID (BottomBar.jsx already makes one for
  // local optimistic-UI reconciliation, it just never reached the server
  // before this). Lets message.js treat a retried send (retryWithBackoff
  // firing again after a lost response, or a double-tap) as "return the
  // message that already exists" instead of inserting a second row.
  // No `default` — a message sent without one must leave the field
  // genuinely ABSENT, not explicitly null. Mongo's sparse index option
  // only excludes documents missing the field entirely; an explicit `null`
  // is a real indexed value, so every no-clientID message would otherwise
  // collide with every other no-clientID message in the same room/author.
  clientID: { type: String },
});

// Every message list/pagination/sync query filters by room first, then ranges on _id
// (already indexed as the primary key) — a single index on room covers all of them.
MessageSchema.index({ room: 1 });

// Idempotency guard for retried sends — unique per (room, author, clientID)
// rather than globally unique, so a colliding UUID from two different rooms/
// authors (astronomically unlikely, but not the actual guarantee this needs)
// can never cross-block unrelated sends.
//
// partialFilterExpression, NOT sparse:true — a compound sparse index only
// excludes a document if EVERY indexed field is missing; system messages
// (postSystemMessage.js) have no `author`, so they'd still be indexed with
// {author: null, clientID: null} and collide with every other system
// message in the same room. A partial index expresses the actual intent
// directly: only enforce uniqueness on rows that genuinely opted in by
// setting a real clientID string.
MessageSchema.index(
  { room: 1, author: 1, clientID: 1 },
  { unique: true, partialFilterExpression: { clientID: { $type: 'string' } } },
);

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
