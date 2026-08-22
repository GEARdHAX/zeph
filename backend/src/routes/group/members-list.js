const Room = require('../../models/Room');
const GroupMember = require('../../models/GroupMember');
const groupPolicy = require('../../authorization/groupPolicy');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

// Cursor pagination — same _id-based idiom as more-messages.js. Bounded
// limit regardless of what the client requests, so a group with thousands
// of members can never be pulled in one unbounded query.
module.exports = async (req, res) => {
  let { id, cursor, limit } = req.fields;

  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembership(room._id, req.user.id);
  if (!membership) return res.status(404).json({ error: true });

  const query = { group: room._id, active: true };
  if (cursor) query._id = { $lt: cursor };

  const members = await GroupMember.find(query)
    .sort({ _id: -1 })
    .limit(limit)
    .populate({ path: 'user', select: '-email -password -friends -__v -level -vaultPinHash', populate: [{ path: 'picture' }] })
    .lean();

  const nextCursor = members.length === limit ? members[members.length - 1]._id : null;

  res.status(200).json({
    members: members.map((m) => ({
      _id: m._id, user: m.user, role: m.role, joinedAt: m.joinedAt, mutedUntil: m.mutedUntil,
    })),
    cursor: nextCursor,
    limit,
  });
};
