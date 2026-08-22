const Message = require('../models/Message');
const Room = require('../models/Room');
const store = require('../store');
const logger = require('../logger');
const groupPolicy = require('../authorization/groupPolicy');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');

// Client emits this once it has received message-in and rendered the
// message locally (delivery, not read — see message-read.js for that).
// $addToSet keeps this idempotent, same as readBy — a duplicate/retried
// ack is a harmless no-op, not a second DB write or a second emit.
module.exports = async (socket, data) => {
  const { roomID, messageID } = data || {};
  const readerID = socket.decoded_token && socket.decoded_token.id;
  if (!readerID || !roomID || !messageID) return;

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return;
  }
  if (!room) return;

  if (room.isGroup) {
    const membership = await groupPolicy.getMembershipWithFallback(room._id, readerID);
    if (!membership) return;
  } else {
    const isMember = room.people.some((person) => person.toString() === readerID.toString());
    if (!isMember) return;
    const boundaryViolation = await roomHasBoundaryViolation({
      room, callerID: readerID, callerLevel: socket.decoded_token.level,
    });
    if (boundaryViolation) return;
  }

  let message;
  try {
    message = await Message.findOneAndUpdate(
      { _id: messageID, room: roomID },
      { $addToSet: { deliveredTo: readerID } },
      { new: true },
    );
  } catch (e) {
    logger.warn({ err: e, roomID, messageID }, 'Failed to record message delivery');
    return;
  }
  if (!message) return;

  room.people.forEach((person) => {
    const personUserID = person.toString();
    if (personUserID !== readerID.toString()) {
      store.io.to(personUserID).emit('message-delivered', { roomID, messageID, readerID });
    }
  });
};
