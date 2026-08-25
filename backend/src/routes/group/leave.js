const Room = require('../../models/Room');
const User = require('../../models/User');
const GroupMember = require('../../models/GroupMember');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const broadcastToGroup = require('../../utils/broadcastToGroup');
const postSystemMessage = require('../../utils/postSystemMessage');
const logger = require('../../logger');

// Self-removal — any ADMIN/MEMBER. The OWNER must transfer ownership or
// delete the group instead (a group can't be left ownerless).
module.exports = async (req, res) => {
  const { id } = req.fields;
  const userId = req.user.id;

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembership(room._id, userId);
  if (!membership) return res.status(404).json({ error: true });

  if (membership.role === groupPolicy.Roles.OWNER) {
    return res.status(400).json({ error: true, reason: 'owner_must_use_delete_endpoint' });
  }

  const remainingMemberIds = room.people.filter((p) => p.toString() !== userId.toString());

  await GroupMember.updateOne({ _id: membership._id }, { $set: { active: false, status: 'LEFT', updatedAt: new Date() } });
  await Room.updateOne({ _id: room._id }, { $pull: { people: userId } });

  forceLeaveGroupRoom(userId.toString(), room._id.toString(), { reason: 'left', groupName: room.title });

  logger.info({ groupId: room._id, actorId: userId, targetId: userId, selfLeave: true }, 'group_member_removed');
  broadcastToGroup(remainingMemberIds, 'group:member:removed', { groupId: room._id, userId, self: false });

  const leaver = await User.findById(userId).select('firstName lastName username');
  const leaverName = leaver ? `${leaver.firstName || ''} ${leaver.lastName || ''}`.trim() || leaver.username : 'A member';
  await postSystemMessage(room._id, `${leaverName} left the group`, remainingMemberIds)
    .catch((err) => logger.warn({ err, groupId: room._id }, 'Failed to post leave system message'));

  res.status(200).json({ status: 'success' });
};
