const Message = require('../models/Message');
const logger = require('../logger');

module.exports = (socket, data) => {
  logger.debug({ data }, 'more-images event received');

  let { roomID, messageID } = data;

  Message.find({ room: roomID, type: 'image', _id: { $lt: messageID } })
    .sort({ _id: -1 })
    .limit(20)
    .populate({
      path: 'author',
      select: '-email -password -friends -__v',
      populate: {
        path: 'picture',
      },
    })
    .then((images) => {
      socket.emit('more-images', { status: 200, images });
    });
};
