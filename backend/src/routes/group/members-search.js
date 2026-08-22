const Room = require('../../models/Room');
const GroupMember = require('../../models/GroupMember');
const User = require('../../models/User');
const groupPolicy = require('../../authorization/groupPolicy');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Server-side member search within a single group — never an unbounded
// "return every member" call, and never a search across other groups'
// membership.
module.exports = async (req, res) => {
  let {
    id, search, limit,
  } = req.fields;

  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  search = typeof search === 'string' ? search.slice(0, 100) : '';

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembership(room._id, req.user.id);
  if (!membership) return res.status(404).json({ error: true });

  const safeSearch = escapeRegex(search);
  const matchingUserIds = await User.find({
    $or: [
      { username: { $regex: safeSearch, $options: 'i' } },
      { firstName: { $regex: safeSearch, $options: 'i' } },
      { lastName: { $regex: safeSearch, $options: 'i' } },
    ],
  }).distinct('_id');

  const members = await GroupMember.find({ group: room._id, active: true, user: { $in: matchingUserIds } })
    .sort({ _id: -1 })
    .limit(limit)
    .populate({ path: 'user', select: '-email -password -friends -__v -level -vaultPinHash', populate: [{ path: 'picture' }] })
    .lean();

  res.status(200).json({
    members: members.map((m) => ({
      _id: m._id, user: m.user, role: m.role, joinedAt: m.joinedAt,
    })),
    limit,
  });
};
