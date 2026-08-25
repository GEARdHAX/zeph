const Message = require('../models/Message');
const Room = require('../models/Room');
const store = require('../store');
const groupPolicy = require('../authorization/groupPolicy');

module.exports = async (req, res, next) => {
  const { roomID, messageID, messageIDs } = req.fields;
  const readerID = req.user.id;

  // Accepts either a single messageID (legacy call shape, still used by the
  // message-in live-read path) or a messageIDs array (used when opening a
  // room to mark its whole unread backlog read in one request instead of
  // one call per message).
  const ids = Array.isArray(messageIDs) ? messageIDs : (messageID ? [messageID] : []);
  if (!roomID || ids.length === 0) {
    return res.status(400).json({ error: true });
  }

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return res.status(404).json({ error: true });
  }

  if (!room || room.disabledAt) {
    return res.status(404).json({ error: true });
  }

  if (room.isGroup) {
    const membership = await groupPolicy.getMembershipWithFallback(room._id, readerID);
    if (!membership) return res.status(403).json({ error: true });
  } else {
    const isMember = room.people.some((person) => person.toString() === readerID.toString());
    if (!isMember) {
      return res.status(403).json({ error: true });
    }
  }

  let result;
  try {
    // One updateMany for the whole backlog instead of one write per message —
    // the query itself (room + _id in ids) is the authorization check, same
    // as the single-message path above, so a caller can never mark a message
    // in a room they don't belong to as read regardless of batch size.
    result = await Message.updateMany(
      { _id: { $in: ids }, room: roomID },
      { $addToSet: { readBy: readerID } },
    );
  } catch (e) {
    return res.status(404).json({ error: true });
  }

  if (!result || result.matchedCount === 0) {
    return res.status(404).json({ error: true });
  }

  room.people.forEach((person) => {
    const personUserID = person.toString();
    if (personUserID !== readerID.toString()) {
      store.io.to(personUserID).emit('message-read', { roomID, messageIDs: ids, readerID });
    }
  });

  res.status(200).json({ status: 'success', messageIDs: ids });
};
