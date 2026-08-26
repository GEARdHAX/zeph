const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
  shield: String,
  name: String,
  // Legacy full local-disk path (e.g. "./data/<userId>/<shieldedID>.jpg") —
  // still populated for backwards-compat reads, but no longer written by
  // upload.js. See storageKey.
  location: String,
  // Relative storage.js key (matches Media.storageKey's convention) —
  // populated by every upload since storage.js migration, resolved via
  // storage.getObjectStream() which transparently uses R2 (when
  // R2_ENDPOINT/R2_ACCESS_KEY_ID are set) or local disk otherwise. A row
  // with only `location` (no storageKey) predates this migration and is
  // served via the old direct-fs path instead. See DECISIONS.md.
  storageKey: { type: String, default: null },
  author: { type: Schema.ObjectId, ref: 'users' },
  size: Number,
  shieldedID: String,
});

// Every image request (images.js) looks up by shieldedID — fired on every rendered attachment.
MessageSchema.index({ shieldedID: 1 });

module.exports = Image = mongoose.model('images', MessageSchema);
