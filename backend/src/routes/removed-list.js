const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

// Lists conversations THIS user has removed from their own inbox
// (conversation/delete.js's per-user deletedAt tombstone — not the Private
// Vault's isHidden, which is a separate, vault-auth-gated concept with its
// own list route). Exists to close a real gap: a removed conversation only
// silently reappears when someone else sends a new message into it (see
// message.js's reappearance logic) — if every member has removed it and
// nobody has a direct link/URL to the room, there was previously no way for
// anyone to find or restore it at all. Mirrors vault-list.js's shape (same
// populate chain, same Room row component renders both) minus the vault
// token requirement, since removal isn't a security boundary.
module.exports = async (req, res) => {
  let { limit } = req.fields;
  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const states = await ConversationUserState.find({
    user: req.user.id,
    deletedAt: { $ne: null },
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
      select: '-email -password -friends -__v -vaultPinHash',
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
