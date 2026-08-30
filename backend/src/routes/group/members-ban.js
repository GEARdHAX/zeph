const Room = require('../../models/Room');
const User = require('../../models/User');
const GroupMember = require('../../models/GroupMember');
const GroupAuditLog = require('../../models/GroupAuditLog');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const broadcastToGroup = require('../../utils/broadcastToGroup');
const postSystemMessage = require('../../utils/postSystemMessage');
const logger = require('../../logger');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');

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
    SecurityEventService.record({
      type: 'PERMISSION_DENIED',
      severity: 'medium',
      actor: { userId: actorId },
      source: securityEventContext(req),
      target: { resource: 'group', resourceId: room._id.toString(), action: 'ban_member' },
      result: 'blocked',
      metadata: { reason: 'role_hierarchy', targetUserId: userId },
    });
    return res.status(403).json({ error: true });
  }

  const remainingMemberIds = room.people.filter((p) => p.toString() !== userId.toString());
  const [actor, target] = await Promise.all([
    User.findById(actorId).select('firstName lastName username'),
    User.findById(userId).select('firstName lastName username'),
  ]);
  const actorName = actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.username : null;
  const targetName = target ? `${target.firstName || ''} ${target.lastName || ''}`.trim() || target.username : 'A member';

  await GroupMember.updateOne(
    { _id: targetMembership._id },
    { $set: { status: 'BANNED', active: false, removedBy: actorId, updatedAt: new Date() } },
  );
  await Room.updateOne({ _id: room._id }, { $pull: { people: userId } });
  await GroupAuditLog.create({
    group: room._id, actor: actorId, action: 'member_banned', target: userId,
  });

  forceLeaveGroupRoom(userId.toString(), room._id.toString(), {
    reason: 'banned', groupName: room.title, actorName,
  });

  logger.info({ groupId: room._id, actorId, targetId: userId }, 'group_member_banned');
  broadcastToGroup(remainingMemberIds, 'group:member:banned', { groupId: room._id, userId }, { excludeUserId: actorId });
  await postSystemMessage(
    room._id,
    actorName ? `${targetName} was banned by ${actorName}` : `${targetName} was banned`,
    remainingMemberIds,
  ).catch((err) => logger.warn({ err, groupId: room._id }, 'Failed to post ban system message'));

  res.status(200).json({ status: 'success' });
};
