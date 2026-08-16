const Message = require('../models/Message');
const Room = require('../models/Room');
const store = require('../store');

module.exports = async (req, res, next) => {
  const { roomID, messageID } = req.fields;
  const readerID = req.user.id;

  if (!roomID || !messageID) {
    return res.status(400).json({ error: true });
  }

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return res.status(404).json({ error: true });
  }

  if (!room) {
    return res.status(404).json({ error: true });
  }

  const isMember = room.people.some((person) => person.toString() === readerID.toString());
  if (!isMember) {
    return res.status(403).json({ error: true });
  }

  let message;
  try {
    message = await Message.findOneAndUpdate(
      { _id: messageID, room: roomID },
      { $addToSet: { readBy: readerID } },
      { new: true },
    );
  } catch (e) {
    return res.status(404).json({ error: true });
  }

  if (!message) {
    return res.status(404).json({ error: true });
  }

  room.people.forEach((person) => {
    const personUserID = person.toString();
    if (personUserID !== readerID.toString()) {
      store.io.to(personUserID).emit('message-read', { roomID, messageID, readerID });
    }
  });

  res.status(200).json({ status: 'success', messageID, readBy: message.readBy });
};
