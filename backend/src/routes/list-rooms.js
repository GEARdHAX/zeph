const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

module.exports = async (req, res, next) => {
  let { limit } = req.fields;

  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  // Hidden (vaulted) and per-user-deleted conversations are excluded from
  // the normal inbox entirely — not filtered client-side, so their
  // existence/preview/unread state can never leak through this response.
  const excludedStates = await ConversationUserState.find({
    user: req.user.id,
    $or: [{ isHidden: true }, { deletedAt: { $ne: null } }],
  });
  const excludedIds = excludedStates.map((s) => s.conversation);

  Room.find({
    people: { $in: [req.user.id] },
    _id: { $nin: excludedIds },
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
