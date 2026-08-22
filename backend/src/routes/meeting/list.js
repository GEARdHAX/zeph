const Meeting = require('../../models/Meeting');
const MeetingUserState = require('../../models/MeetingUserState');

module.exports = async (req, res, next) => {
  let { limit } = req.fields;

  !limit && (limit = 30);

  const deletedStates = await MeetingUserState.find({ user: req.user.id, deletedAt: { $ne: null } });
  const excludedIds = deletedStates.map((s) => s.meeting);

  Meeting.find({
    $or: [{ users: { $in: [req.user.id] } }, { caller: req.user.id }, { callee: req.user.id }],
    _id: { $nin: excludedIds },
  })
    .sort({ lastEnter: -1 })
    .populate({
      path: 'users',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: {
        path: 'picture',
      },
    })
    .populate([{ path: 'caller', strictPopulate: false }])
    .populate([{ path: 'callee', strictPopulate: false }])
    .populate('group')
    .limit(limit)
    .exec((err, meetings) => {
      if (err) return res.status(500).json({ error: true });
      res.status(200).json({ limit, meetings });
    });
};
