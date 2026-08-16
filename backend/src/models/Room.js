const mongoose = require('./mongoose');
const Schema = mongoose.Schema;

const RoomSchema = new Schema({
  people: [{ type: Schema.ObjectId, ref: 'users' }],
  title: String,
  picture: { type: Schema.ObjectId, ref: 'images' },
  isGroup: { type: Boolean, default: false },
  lastUpdate: Date,
  lastAuthor: { type: Schema.ObjectId, ref: 'users' },
  lastMessage: { type: Schema.ObjectId, ref: 'messages' },
});

// list-rooms.js filters by people membership and sorts by lastUpdate — compound index
// covers both the filter and the sort in a single index scan.
RoomSchema.index({ people: 1, lastUpdate: -1 });

module.exports = User = mongoose.model('rooms', RoomSchema);
