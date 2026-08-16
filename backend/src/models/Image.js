const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
  shield: String,
  name: String,
  location: String,
  author: { type: Schema.ObjectId, ref: 'users' },
  size: Number,
  shieldedID: String,
});

// Every image request (images.js) looks up by shieldedID — fired on every rendered attachment.
MessageSchema.index({ shieldedID: 1 });

module.exports = Image = mongoose.model('images', MessageSchema);
