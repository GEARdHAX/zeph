const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const EmailSchema = new Schema({
  from: String,
  to: String,
  subject: String,
  html: String,
  sent: {
    type: Boolean,
    default: false,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  lastError: String,
  dateAdded: {
    type: Date,
    default: Date.now,
  },
  dateSent: Date,
});

const Email = mongoose.model('Email', EmailSchema);

module.exports = Email;
