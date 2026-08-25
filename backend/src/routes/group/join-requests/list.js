const Room = require('../../../models/Room');
const GroupMember = require('../../../models/GroupMember');
const groupPolicy = require('../../../authorization/groupPolicy');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

// ADMIN/OWNER only — same cursor-pagination idiom as members-list.js. POST
// (not GET+query) to match this codebase's convention: every route reads
// req.fields (express-formidable's body parser), never req.query.
module.exports = async (req, res) => {
  let { groupId, cursor, limit } = req.fields;

  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const room = await Room.findOne({ _id: groupId, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembership(room._id, req.user.id);
  if (!membership || !groupPolicy.hasCapability(membership.role, groupPolicy.Capabilities.APPROVE_REQUESTS)) {
    return res.status(404).json({ error: true });
  }

  const query = { group: room._id, status: 'PENDING' };
  if (cursor) query._id = { $lt: cursor };

  const requests = await GroupMember.find(query)
    .sort({ _id: -1 })
    .limit(limit)
    .populate({ path: 'user', select: '-email -password -friends -__v -level -vaultPinHash', populate: [{ path: 'picture' }] })
    .lean();

  const nextCursor = requests.length === limit ? requests[requests.length - 1]._id : null;

  res.status(200).json({
    requests: requests.map((r) => ({ _id: r._id, user: r.user, createdAt: r.joinedAt })),
    cursor: nextCursor,
    limit,
  });
};
