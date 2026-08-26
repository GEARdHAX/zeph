const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
  shield: String,
  name: String,
  // Legacy full local-disk path — still populated for backwards-compat
  // reads, but no longer written by upload-file.js. See storageKey.
  location: String,
  // Relative storage.js key — see Image.js's storageKey comment, same
  // convention/rationale.
  storageKey: { type: String, default: null },
  author: { type: Schema.ObjectId, ref: 'users' },
  size: Number,
  shieldedID: String,
  type: String,
});

// Every file request (files.js) looks up by shieldedID.
MessageSchema.index({ shieldedID: 1 });

module.exports = Image = mongoose.model('files', MessageSchema);
