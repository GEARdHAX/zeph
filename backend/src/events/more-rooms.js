const Room = require('../models/Room');
const logger = require('../logger');

module.exports = (socket, data) => {
  logger.debug({ data }, 'more-rooms event received');

  let { roomID } = data;

  Room.find({
    people: { $in: [socket.decoded_token.id] },
    lastMessage: { $ne: null },
    lastUpdate: { $lt: roomID },
  })
    .sort({ lastUpdate: -1 })
    .limit(20)
    .populate({
      path: 'people',
      select: '-email -password -friends -__v',
      populate: {
        path: 'picture',
      },
    })
    .populate('lastMessage')
    .then((rooms) => {
      socket.emit('more-rooms', { status: 200, rooms });
    });
};
