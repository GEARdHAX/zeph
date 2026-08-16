const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
  shield: String,
  name: String,
  location: String,
  author: { type: Schema.ObjectId, ref: 'users' },
  size: Number,
  shieldedID: String,
  type: String,
});

// Every file request (files.js) looks up by shieldedID.
MessageSchema.index({ shieldedID: 1 });

module.exports = Image = mongoose.model('files', MessageSchema);
