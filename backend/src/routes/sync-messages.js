const Message = require('../models/Message');
const Room = require('../models/Room');

// Reconnect resync: returns messages added to a room after lastMessageID, newest-cursor-first
// like more-messages.js but inverted ($gt instead of $lt) since this fills a forward gap
// left by a dropped socket connection instead of paging backward through history.
module.exports = async (req, res, next) => {
  const { roomID, lastMessageID } = req.fields;

  if (!roomID) {
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

  const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
  if (!isMember) {
    return res.status(403).json({ error: true });
  }

  const query = lastMessageID ? { room: roomID, _id: { $gt: lastMessageID } } : { room: roomID };

  Message.find(query)
    .sort({ _id: 1 })
    .limit(200)
    .populate({
      path: 'author',
      select: '-email -password -friends -__v',
      populate: {
        path: 'picture',
      },
    })
    .lean()
    .then((messages) => {
      res.status(200).json({
        messages: messages.map((e) => {
          if (e.author) {
            return e;
          } else {
            return {
              ...e,
              author: {
                firstName: 'Deleted',
                lastName: 'User',
              },
            };
          }
        }),
      });
    })
    .catch((err) => {
      res.status(500).json({ error: true });
    });
};
