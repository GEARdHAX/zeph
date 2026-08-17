const Message = require('../models/Message');
const sanitizeDeletedMessage = require('../utils/sanitizeDeletedMessage');
const requireVisibleConversation = require('../utils/requireVisibleConversation');
const { hasValidVaultToken } = require('../vault/vaultToken');

module.exports = async (req, res, next) => {
  let { roomID, firstMessageID } = req.fields;

  const visibility = await requireVisibleConversation({
    roomID,
    userID: req.user.id,
    hasVaultAuth: hasValidVaultToken(req),
  });
  if (!visibility.ok) {
    return res.status(visibility.status).json({ error: true, reason: visibility.reason });
  }

  Message.find({ room: roomID, _id: { $lt: firstMessageID } })
    .sort({ _id: -1 })
    .limit(20)
    .populate({
      path: 'author',
      select: '-email -password -friends -__v',
      populate: {
        path: 'picture',
      },
    })
    .lean()
    .then((messages) => {
      messages.reverse();
      res.status(200).json({
        messages: messages
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
      });
    });
};
