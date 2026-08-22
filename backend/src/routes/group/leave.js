const Room = require('../../models/Room');
const GroupMember = require('../../models/GroupMember');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const logger = require('../../logger');
const store = require('../../store');

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

  await GroupMember.updateOne({ _id: membership._id }, { $set: { active: false, updatedAt: new Date() } });
  await Room.updateOne({ _id: room._id }, { $pull: { people: userId } });

  forceLeaveGroupRoom(userId.toString(), room._id.toString());

  logger.info({ groupId: room._id, actorId: userId, targetId: userId, selfLeave: true }, 'group_member_removed');
  store.io.to(`group:${room._id}`).emit('group:member:removed', { groupId: room._id, userId, self: true });

  res.status(200).json({ status: 'success' });
};
