const Message = require('../models/Message');
const Room = require('../models/Room');

module.exports = async (req, res, next) => {
  let { id } = req.fields;

  let room;
  try {
    room = await Room.findOne({ _id: id });
  } catch (e) {
    return res.status(404).json({ status: 'error', message: 'room not found' });
  }

  if (!room) {
    return res.status(404).json({ status: 'error', message: 'room not found' });
  }

  const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
  if (!isMember) {
    return res.status(403).json({ status: 'error', message: 'not a member of this room' });
  }

  try {
    await Room.findOneAndDelete({ _id: id });
  } catch (e) {
    return res.status(404).json({ status: 'error', message: 'room not found' });
  }

  try {
    await Message.deleteMany({ room: id });
  } catch (e) {
    return res.status(404).json({ status: 'error', message: 'error while deleting messages' });
  }

  res.status(200).json({ status: 'success', message: 'room deleted' });
};
