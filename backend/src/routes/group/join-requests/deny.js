const Room = require('../../../models/Room');
const GroupMember = require('../../../models/GroupMember');
const GroupAuditLog = require('../../../models/GroupAuditLog');
const groupPolicy = require('../../../authorization/groupPolicy');
const logger = require('../../../logger');
const store = require('../../../store');

// Denied -> status:'LEFT', not deleted. Leaves no permanent block (unlike
// ban) — the row is reusable if this user requests again later, matching
// join-requests/create.js's upsert-over-LEFT/REMOVED path.
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

  const updated = await GroupMember.findOneAndUpdate(
    { group: room._id, user: userId, status: 'PENDING' },
    { $set: { status: 'LEFT', active: false, updatedAt: new Date() } },
    { new: true },
  );
  if (!updated) return res.status(409).json({ error: true, reason: 'REQUEST_NOT_PENDING' });

  await GroupAuditLog.create({
    group: room._id, actor: actorId, action: 'request_denied', target: userId,
  });

  logger.info({ groupId: room._id, actorId, targetId: userId }, 'group_join_request_denied');
  store.io.to(`group:${room._id}`).emit('group:join-request:denied', { groupId: room._id, userId });

  res.status(200).json({ status: 'success' });
};
