const Message = require('../models/Message');
const Room = require('../models/Room');
const groupPolicy = require('../authorization/groupPolicy');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const logger = require('../logger');

// Phase 7 audit finding — same gap/fix as events/more-messages.js: this
// handler previously trusted a client-supplied roomID with no membership
// check at all.
module.exports = async (socket, data) => {
  logger.debug({ data }, 'more-images event received');

  const { roomID, messageID } = data || {};
  const callerID = socket.decoded_token.id;

  const room = await Room.findOne({ _id: roomID });
  if (!room || room.disabledAt) {
    return socket.emit('more-images', { status: 404, images: [] });
  }
  const canRead = await groupPolicy.canReadRoomHistory(room, callerID);
  if (!canRead) {
    return socket.emit('more-images', { status: 403, images: [] });
  }
  const boundaryViolation = await roomHasBoundaryViolation({
    room, callerID, callerLevel: socket.decoded_token.level,
  });
  if (boundaryViolation) {
    return socket.emit('more-images', { status: 404, images: [] });
  }

  const images = await Message.find({ room: roomID, type: 'image', _id: { $lt: messageID } })
    .sort({ _id: -1 })
    .limit(20)
    .populate({
      path: 'author',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: {
        path: 'picture',
      },
    });
  return socket.emit('more-images', { status: 200, images });
};
