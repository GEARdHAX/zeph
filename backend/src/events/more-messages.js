const Message = require('../models/Message');
const logger = require('../logger');

module.exports = (socket, data) => {
  logger.debug({ data }, 'more-messages event received');

  let { roomID, messageID } = data;

  Message.find({ room: roomID, _id: { $lt: messageID } })
    .sort({ _id: -1 })
    .limit(20)
    .populate({
      path: 'author',
      select: '-email -password -friends -__v',
      populate: {
        path: 'picture',
      },
    })
    .then((messages) => {
      messages.reverse();
      socket.emit('more-messages', { status: 200, messages });
    });
};
