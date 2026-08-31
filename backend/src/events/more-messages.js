const Message = require('../models/Message');
const Room = require('../models/Room');
const groupPolicy = require('../authorization/groupPolicy');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const logger = require('../logger');

// Phase 7 audit finding: this handler previously trusted a client-supplied
// roomID with NO membership check — any authenticated socket could page
// through any room's history by guessing/enumerating a Mongo ObjectId.
// (The frontend does not actually emit this event today — it uses the
// HTTP twin, routes/more-messages.js, exclusively — but a server-side
// handler is reachable by any authenticated socket regardless of whether
// the shipped client happens to call it, so this is a real gap, not a
// theoretical one.) Same membership/boundary checks as the HTTP route,
// intentionally NOT copying that route's pagination/hasMore/delete-history-
// cutoff/sanitize logic — those are UI-shape concerns the HTTP route
// already owns; this fix is scoped to the actual security gap.
module.exports = async (socket, data) => {
  logger.debug({ data }, 'more-messages event received');

  const { roomID, messageID } = data || {};
  const callerID = socket.decoded_token.id;

  const room = await Room.findOne({ _id: roomID });
  if (!room || room.disabledAt) {
    return socket.emit('more-messages', { status: 404, messages: [] });
  }
  const canRead = await groupPolicy.canReadRoomHistory(room, callerID);
  if (!canRead) {
    return socket.emit('more-messages', { status: 403, messages: [] });
  }
  const boundaryViolation = await roomHasBoundaryViolation({
    room, callerID, callerLevel: socket.decoded_token.level,
  });
  if (boundaryViolation) {
    return socket.emit('more-messages', { status: 404, messages: [] });
  }

  const messages = await Message.find({ room: roomID, _id: { $lt: messageID } })
    .sort({ _id: -1 })
    .limit(20)
    .populate({
      path: 'author',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: {
        path: 'picture',
      },
    });
  messages.reverse();
  return socket.emit('more-messages', { status: 200, messages });
};
