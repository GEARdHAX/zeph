const Room = require('../../../models/Room');
const GroupMember = require('../../../models/GroupMember');
const groupPolicy = require('../../../authorization/groupPolicy');
const logger = require('../../../logger');
const store = require('../../../store');

// No-invite discovery path for a PRIVATE group the caller already knows the
// id of (no public group search/browse exists — see DECISIONS.md). Distinct
// from group/invites/join.js: an invite link IS the approval, this route
// creates a PENDING row an admin must act on.
module.exports = async (req, res) => {
  const { groupId } = req.fields;
  const userId = req.user.id;

  const room = await Room.findOne({ _id: groupId, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  if (await groupPolicy.isBanned(room._id, userId)) {
    return res.status(404).json({ error: true });
  }

  const existing = await groupPolicy.getMembershipWithFallback(room._id, userId);
  if (existing) return res.status(409).json({ error: true, reason: 'ALREADY_MEMBER' });

  // GroupMember's unique index is {group,user} — a single row per pair for
  // the group's entire history (LEFT/REMOVED rows are soft-state, never
  // deleted). A prior LEFT/REMOVED row from this same user must be reused
  // (upsert), not collide as a duplicate — only an existing PENDING row (a
  // real duplicate request) or BANNED (blocked above) should refuse this.
  let request;
  try {
    request = await GroupMember.findOneAndUpdate(
      { group: room._id, user: userId, status: { $in: ['LEFT', 'REMOVED'] } },
      {
        $set: {
          role: 'MEMBER', status: 'PENDING', active: false, updatedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    if (err.code === 11000) {
      // Row exists but isn't LEFT/REMOVED (e.g. already PENDING) — the
      // filter above didn't match it, so upsert couldn't touch it either.
      return res.status(409).json({ error: true, reason: 'ALREADY_REQUESTED' });
    }
    logger.error({ err, groupId: room._id, userId }, 'Failed to create join request');
    return res.status(500).json({ error: true });
  }

  logger.info({ groupId: room._id, userId }, 'group_join_request_created');
  store.io.to(`group:${room._id}`).emit('group:join-request:created', { groupId: room._id, userId, requestId: request._id });

  res.status(200).json({ status: 'pending' });
};
