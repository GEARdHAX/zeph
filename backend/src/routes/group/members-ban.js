const Room = require('../../models/Room');
const GroupMember = require('../../models/GroupMember');
const GroupAuditLog = require('../../models/GroupAuditLog');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const logger = require('../../logger');
const store = require('../../store');

// Distinct from members-remove.js: a ban also blocks every future rejoin
// path (join-requests/create.js, group/invites/join.js both check
// groupPolicy.isBanned). Same role-hierarchy rules as remove — reuses
// canRemoveMember rather than a separate ban-hierarchy rule, since "who can
// ban whom" is the same question as "who can remove whom".
module.exports = async (req, res) => {
  const { groupId, userId } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: groupId, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const actorMembership = await groupPolicy.getMembership(room._id, actorId);
  if (!actorMembership) return res.status(404).json({ error: true });

  const targetMembership = await groupPolicy.getMembership(room._id, userId);
  if (!targetMembership) return res.status(404).json({ error: true });

  if (!groupPolicy.hasCapability(actorMembership.role, groupPolicy.Capabilities.BAN_MEMBER)
    || !groupPolicy.canRemoveMember({ actorRole: actorMembership.role, targetRole: targetMembership.role })) {
    logger.warn({ groupId: room._id, actorId, targetId: userId, reason: 'role_hierarchy' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  await GroupMember.updateOne(
    { _id: targetMembership._id },
    { $set: { status: 'BANNED', active: false, updatedAt: new Date() } },
  );
  await Room.updateOne({ _id: room._id }, { $pull: { people: userId } });
  await GroupAuditLog.create({
    group: room._id, actor: actorId, action: 'member_banned', target: userId,
  });

  forceLeaveGroupRoom(userId.toString(), room._id.toString());

  logger.info({ groupId: room._id, actorId, targetId: userId }, 'group_member_banned');
  store.io.to(`group:${room._id}`).emit('group:member:banned', { groupId: room._id, userId });

  res.status(200).json({ status: 'success' });
};
