const Message = require('../models/Message');
const Room = require('../models/Room');
const logger = require('../logger');
const sanitizeDeletedMessage = require('../utils/sanitizeDeletedMessage');
const requireVisibleConversation = require('../utils/requireVisibleConversation');
const { hasValidVaultToken } = require('../vault/vaultToken');

module.exports = async (req, res, next) => {
  let { id } = req.fields;

  const visibility = await requireVisibleConversation({
    roomID: id,
    userID: req.user.id,
    hasVaultAuth: hasValidVaultToken(req),
  });
  if (!visibility.ok) {
    return res.status(visibility.status).json({ error: true, reason: visibility.reason });
  }

  const findMessagesAndEmit = (room) => {
    Message.find({ room: room._id })
      .sort({ _id: -1 })
      .limit(50)
      .populate({
        path: 'author',
        select: '-email -password -friends -__v',
        populate: [
          {
            path: 'picture',
          },
        ],
      })
      .populate([{ path: 'file', strictPopulate: false }])
      .lean()
      .then((messages) => {
        messages.reverse();
        Message.find({ room: room._id, type: 'image' })
          .sort({ _id: -1 })
          .limit(50)
          .populate({
            path: 'author',
            select: '-email -password -friends -__v',
            populate: {
              path: 'picture',
            },
          })
          .then((images) => {
            res.status(200).json({
              room: {
                _id: room._id,
                people: room.people,
                title: room.title,
                isGroup: room.isGroup,
                lastUpdate: room.lastUpdate,
                lastAuthor: room.lastAuthor,
                lastMessage: room.lastMessage,
                picture: room.picture,
                messages: messages
                  // Own "delete for me" state stays hidden on every fresh load too.
                  .filter((e) => !(e.deletedFor || []).some((uid) => uid.toString() === req.user.id.toString()))
                  .map((e) => {
                    const message = sanitizeDeletedMessage(e);
                    if (message.author) {
                      return message;
                    } else {
                      return {
                        ...message,
                        author: {
                          firstName: 'Deleted',
                          lastName: 'User',
                        },
                      };
                    }
                  }),
                images,
              },
            });
          });
      });
  };

  Room.findOne({ _id: id })
    .populate([{ path: 'picture', strictPopulate: false }])
    .populate({
      path: 'people',
      select: '-email -tagLine -password -friends -__v',
      populate: [
        {
          path: 'picture',
        },
      ],
    })
    .exec((err, room) => {
      if (err || !room) {
        if (err) logger.error({ err, roomId: id }, 'Failed to look up room for join-room');
        return res.status(404).json({ error: true });
      }
      if (room.people.filter((person) => req.user.id.toString() === person._id.toString()).length === 0) {
        return res.status(404).json({ error: true });
      }
      findMessagesAndEmit(room);
    });
};
