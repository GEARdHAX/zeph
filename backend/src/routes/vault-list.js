const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const { requireVaultAuth } = require('../vault/vaultToken');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

// Mirrors list-rooms.js's populate chain — a vaulted room is rendered by the
// same frontend Room row component, so the shape must match.
const handler = async (req, res) => {
  let { limit } = req.fields;
  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const states = await ConversationUserState.find({
    user: req.user.id,
    isHidden: true,
    deletedAt: null,
  });
  const conversationIds = states.map((s) => s.conversation);

  if (conversationIds.length === 0) {
    return res.status(200).json({ limit, rooms: [] });
  }

  Room.find({ _id: { $in: conversationIds } })
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

module.exports = [requireVaultAuth, handler];
