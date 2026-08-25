const Room = require('../../models/Room');
const User = require('../../models/User');
const GroupMember = require('../../models/GroupMember');
const groupPolicy = require('../../authorization/groupPolicy');
const logger = require('../../logger');
const store = require('../../store');

// Invite/add flow: authenticate -> verify actor membership+capability ->
// target exists -> admin-boundary gate (invite-time only, see
// groupPolicy.js) -> atomic upsert (handles duplicate/concurrent add) ->
// emit realtime update. See DECISIONS.md D-035.
module.exports = async (req, res) => {
  const { id, userId } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const actorMembership = await groupPolicy.getMembership(room._id, actorId);
  if (!actorMembership) return res.status(404).json({ error: true });

  if (!groupPolicy.hasCapability(actorMembership.role, groupPolicy.Capabilities.ADD_MEMBER)) {
    logger.warn({ groupId: room._id, actorId, reason: 'missing_capability' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  const target = await User.findById(userId).select('_id level');
  // Admin privacy boundary — invite-time gate only, does not apply to an
  // admin already legitimately a member (see groupPolicy.js, DECISIONS.md
  // D-034/D-035). Same anti-enumeration 404 as "target doesn't exist".
  if (!target || (groupPolicy.isPrivileged(target) && !groupPolicy.isPrivileged(req.user))) {
    return res.status(404).json({ error: true });
  }

  // Atomic upsert — the actual concurrency-safety mechanism for duplicate/
  // concurrent add requests, backed by GroupMember's unique {group,user}
  // index. Re-adding an already-active member is an idempotent no-op. A
  // direct add by an admin is a deliberate override of any prior BANNED/
  // REMOVED/LEFT status (unlike an invite-link join, which never overrides
  // a ban — see group/invites/join.js) — status is set to ACTIVE alongside
  // active so the two fields never disagree afterward, see GroupMember.js.
  let membership;
  let wasNew = false;
  try {
    const before = await GroupMember.findOne({ group: room._id, user: target._id });
    membership = await GroupMember.findOneAndUpdate(
      { group: room._id, user: target._id },
      {
        $setOnInsert: { role: 'MEMBER', joinedAt: new Date() },
        $set: { active: true, status: 'ACTIVE', updatedAt: new Date() },
      },
      { upsert: true, new: true },
    );
    wasNew = !before || !before.active;
  } catch (err) {
    if (err.code === 11000) {
      membership = await GroupMember.findOne({ group: room._id, user: target._id });
    } else {
      logger.error({ err, groupId: room._id, actorId }, 'Failed to add group member');
      return res.status(500).json({ error: true });
    }
  }

  if (wasNew) {
    await Room.updateOne({ _id: room._id }, { $addToSet: { people: target._id } });
    logger.info({ groupId: room._id, actorId, targetId: target._id }, 'group_member_added');
    store.io.to(`group:${room._id}`).emit('group:member:added', {
      groupId: room._id, userId: target._id, role: membership.role,
    });
  }

  res.status(200).json({ status: 'success', member: { user: target._id, role: membership.role } });
};
