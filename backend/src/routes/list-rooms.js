const Room = require('../models/Room');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

module.exports = (req, res, next) => {
  let { limit } = req.fields;

  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  Room.find({
    people: { $in: [req.user.id] },
    $or: [
      {
        lastMessage: { $ne: null },
      },
      {
        isGroup: true,
      },
    ],
  })
    .sort({ lastUpdate: -1 })
    .populate([{ path: 'picture', strictPopulate: false }])
    .populate({
      path: 'people',
      select: '-email -password -friends -__v',
      populate: {
        path: 'picture',
      },
    })
    .populate('lastMessage')
    .limit(limit)
    .exec((err, rooms) => {
      if (err) return res.status(500).json({ error: true });
      res.status(200).json({ limit, rooms });
    });
};
