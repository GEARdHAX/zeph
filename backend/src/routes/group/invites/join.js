const GroupInvite = require('../../../models/GroupInvite');
const Room = require('../../../models/Room');
const GroupMember = require('../../../models/GroupMember');
const groupPolicy = require('../../../authorization/groupPolicy');
const logger = require('../../../logger');
const store = require('../../../store');
const { hashToken } = require('../../../lib/inviteToken');

module.exports = async (req, res) => {
  const { token } = req.params;
  const userId = req.user.id;
  const tokenHash = hashToken(token);

  // Atomic claim of one use: filter requires revokedAt:null and (unlimited
  // OR useCount below maxUses), increments useCount in the same operation —
  // closes the TOCTOU window two concurrent joins against a limited-use
  // invite would otherwise race through.
  const invite = await GroupInvite.findOneAndUpdate(
    {
      tokenHash,
      revokedAt: null,
      $or: [{ maxUses: null }, { $expr: { $lt: ['$useCount', '$maxUses'] } }],
    },
    { $inc: { useCount: 1 } },
    { new: true },
  );
  if (!invite) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });

  const room = await Room.findOne({ _id: invite.group, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true, reason: 'GROUP_NOT_FOUND' });

  const existingMembership = await groupPolicy.getMembership(room._id, userId);
  if (existingMembership) return res.status(409).json({ error: true, reason: 'ALREADY_MEMBER' });

  // A ban must never be bypassable by an invite link — checked after the
  // above (an ACTIVE member is "already a member", not "banned", even if
  // they were banned and later re-added by an admin) but before any write.
  if (await groupPolicy.isBanned(room._id, userId)) {
    return res.status(403).json({ error: true, reason: 'BANNED' });
  }

  // Same atomic upsert pattern as group/members-add.js — GroupMember's
  // unique {group,user} index is the real concurrency guard, not this check.
  // status:'ACTIVE' is set explicitly alongside active:true (not just
  // active) so a stale LEFT/REMOVED row's status field never disagrees with
  // active after this write — see GroupMember.js.
  let membership;
  let wasNew = false;
  try {
    const before = await GroupMember.findOne({ group: room._id, user: userId });
    membership = await GroupMember.findOneAndUpdate(
      { group: room._id, user: userId },
      {
        $setOnInsert: { role: 'MEMBER', joinedAt: new Date() },
        $set: { active: true, status: 'ACTIVE', updatedAt: new Date() },
      },
      { upsert: true, new: true },
    );
    wasNew = !before || !before.active;
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: true, reason: 'ALREADY_MEMBER' });
    }
    logger.error({ err, groupId: room._id, userId }, 'Failed to join group via invite');
    return res.status(500).json({ error: true });
  }

  if (wasNew) {
    await Room.updateOne({ _id: room._id }, { $addToSet: { people: userId } });
    logger.info({ groupId: room._id, userId }, 'group.joined');
    store.io.to(`group:${room._id}`).emit('group:member:added', {
      groupId: room._id, userId, role: membership.role,
    });
  }

  res.status(200).json({ status: 'success', group: { _id: room._id, name: room.title } });
};
