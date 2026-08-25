const Room = require('../../models/Room');
const User = require('../../models/User');
const GroupMember = require('../../models/GroupMember');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const broadcastToGroup = require('../../utils/broadcastToGroup');
const postSystemMessage = require('../../utils/postSystemMessage');
const logger = require('../../logger');

// Owner/admin removes another member. Role-hierarchy enforced via
// groupPolicy.canRemoveMember — the OWNER can't be removed here, ADMIN can
// only remove MEMBER. DB write happens before the socket eviction so a
// removed member's live socket can never receive another group broadcast.
module.exports = async (req, res) => {
  const { id, userId } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const actorMembership = await groupPolicy.getMembership(room._id, actorId);
  if (!actorMembership) return res.status(404).json({ error: true });

  const targetMembership = await groupPolicy.getMembership(room._id, userId);
  if (!targetMembership) return res.status(404).json({ error: true });

  if (!groupPolicy.hasCapability(actorMembership.role, groupPolicy.Capabilities.REMOVE_MEMBER)
    || !groupPolicy.canRemoveMember({ actorRole: actorMembership.role, targetRole: targetMembership.role })) {
    logger.warn({ groupId: room._id, actorId, targetId: userId, reason: 'role_hierarchy' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  const remainingMemberIds = room.people.filter((p) => p.toString() !== targetMembership.user.toString());
  const [actor, target] = await Promise.all([
    User.findById(actorId).select('firstName lastName username'),
    User.findById(userId).select('firstName lastName username'),
  ]);
  const actorName = actor ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.username : null;
  const targetName = target ? `${target.firstName || ''} ${target.lastName || ''}`.trim() || target.username : 'A member';

  await GroupMember.updateOne(
    { _id: targetMembership._id },
    { $set: { active: false, status: 'REMOVED', removedBy: actorId, updatedAt: new Date() } },
  );
  await Room.updateOne({ _id: room._id }, { $pull: { people: targetMembership.user } });

  forceLeaveGroupRoom(targetMembership.user.toString(), room._id.toString(), {
    reason: 'removed', groupName: room.title, actorName,
  });

  logger.info({ groupId: room._id, actorId, targetId: userId, selfLeave: false }, 'group_member_removed');
  broadcastToGroup(remainingMemberIds, 'group:member:removed', { groupId: room._id, userId, self: false }, { excludeUserId: actorId });
  await postSystemMessage(
    room._id,
    actorName ? `${targetName} was removed by ${actorName}` : `${targetName} was removed`,
    remainingMemberIds,
  ).catch((err) => logger.warn({ err, groupId: room._id }, 'Failed to post removal system message'));

  res.status(200).json({ status: 'success' });
};
