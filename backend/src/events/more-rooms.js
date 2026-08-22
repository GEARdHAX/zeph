const Room = require('../models/Room');
const User = require('../models/User');
const logger = require('../logger');
const { isPrivileged } = require('../authorization/policy');

module.exports = async (socket, data) => {
  logger.debug({ data }, 'more-rooms event received');

  let { roomID } = data;
  const callerID = socket.decoded_token.id;

  // Admin privacy boundary — same $nin exclusion as list-rooms.js's HTTP
  // twin. See DECISIONS.md.
  let boundaryExcludedIds = [];
  if (!isPrivileged(socket.decoded_token)) {
    const privilegedIds = await User.find({ level: { $ne: 'standard' } }).distinct('_id');
    if (privilegedIds.length) {
      boundaryExcludedIds = await Room.find({
        isGroup: false,
        people: { $in: [callerID] },
        $and: [{ people: { $in: privilegedIds } }],
      }).distinct('_id');
    }
  }

  Room.find({
    people: { $in: [callerID] },
    _id: { $nin: boundaryExcludedIds },
    lastMessage: { $ne: null },
    lastUpdate: { $lt: roomID },
  })
    .sort({ lastUpdate: -1 })
    .limit(20)
    .populate({
      path: 'people',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: {
        path: 'picture',
      },
    })
    .populate('lastMessage')
    .then((rooms) => {
      rooms.forEach((room) => {
        room.people = room.people.map((person) => {
          const obj = person.toObject ? person.toObject() : person;
          delete obj.level;
          return obj;
        });
      });
      socket.emit('more-rooms', { status: 200, rooms });
    });
};
