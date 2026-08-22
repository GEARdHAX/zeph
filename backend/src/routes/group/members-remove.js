const Room = require('../../models/Room');
const GroupMember = require('../../models/GroupMember');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const logger = require('../../logger');
const store = require('../../store');

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

  await GroupMember.updateOne({ _id: targetMembership._id }, { $set: { active: false, updatedAt: new Date() } });
  await Room.updateOne({ _id: room._id }, { $pull: { people: targetMembership.user } });

  forceLeaveGroupRoom(targetMembership.user.toString(), room._id.toString());

  logger.info({ groupId: room._id, actorId, targetId: userId, selfLeave: false }, 'group_member_removed');
  store.io.to(`group:${room._id}`).emit('group:member:removed', { groupId: room._id, userId, self: false });

  res.status(200).json({ status: 'success' });
};
