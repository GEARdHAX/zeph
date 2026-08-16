const Room = require('../models/Room');

module.exports = (req, res, next) => {
  let { id } = req.fields;

  Room.findOne({ _id: id })
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
    .exec((err, room) => {
      if (err || !room) return res.status(404).json({ error: true });

      const isMember = room.people.some((person) => person._id.toString() === req.user.id.toString());
      if (!isMember) return res.status(403).json({ error: true });

      res.status(200).json({ room });
    });
};
