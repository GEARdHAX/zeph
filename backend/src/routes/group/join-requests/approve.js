const Room = require('../../../models/Room');
const GroupMember = require('../../../models/GroupMember');
const GroupAuditLog = require('../../../models/GroupAuditLog');
const groupPolicy = require('../../../authorization/groupPolicy');
const logger = require('../../../logger');
const store = require('../../../store');

module.exports = async (req, res) => {
  const { userId } = req.params;
  const { groupId } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: groupId, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const actorMembership = await groupPolicy.getMembership(room._id, actorId);
  if (!actorMembership || !groupPolicy.hasCapability(actorMembership.role, groupPolicy.Capabilities.APPROVE_REQUESTS)) {
    logger.warn({ groupId: room._id, actorId, reason: 'missing_capability' }, 'group_unauthorized_access_attempt');
    return res.status(404).json({ error: true });
  }

  // CAS on status:'PENDING' — a losing racer (already approved/denied by
  // another admin, or the requester left in the meantime) 409s instead of
  // silently reactivating a stale request, same pattern as members-role.js.
  const updated = await GroupMember.findOneAndUpdate(
    { group: room._id, user: userId, status: 'PENDING' },
    { $set: { status: 'ACTIVE', active: true, updatedAt: new Date() } },
    { new: true },
  );
  if (!updated) return res.status(409).json({ error: true, reason: 'REQUEST_NOT_PENDING' });

  await Room.updateOne({ _id: room._id }, { $addToSet: { people: userId } });
  await GroupAuditLog.create({
    group: room._id, actor: actorId, action: 'request_approved', target: userId,
  });

  logger.info({ groupId: room._id, actorId, targetId: userId }, 'group_join_request_approved');
  store.io.to(`group:${room._id}`).emit('group:member:added', { groupId: room._id, userId, role: updated.role });

  res.status(200).json({ status: 'success' });
};
