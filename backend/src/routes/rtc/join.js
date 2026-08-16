const store = require('../../store');
const logger = require('../../logger');

module.exports = async (req, res, next) => {
  const { id } = req.fields;

  let room;

  try {
    room = await store.rooms.asyncFindOne({ _id: id });
    if (!room.users.includes(req.user.id)) {
      await store.rooms.asyncUpdate({ _id: id }, { $push: { users: req.user.id } });
      room = await store.rooms.asyncFindOne({ _id: id });
    }
  } catch (e) {
    logger.error({ err: e, roomId: id }, 'Failed to join RTC room');
  }

  res.status(200).json(room);
};
