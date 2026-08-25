const Room = require('../../models/Room');
const GroupMember = require('../../models/GroupMember');
const GroupAuditLog = require('../../models/GroupAuditLog');
const groupPolicy = require('../../authorization/groupPolicy');
const logger = require('../../logger');
const store = require('../../store');

// OWNER-only. New owner must already be an ACTIVE member (no implicit add).
// Old owner becomes ADMIN, not demoted further — a deliberate handoff, not
// a removal. Room.ownerId is a denormalized cache (see Room.js's own
// comment) kept in sync here.
module.exports = async (req, res) => {
  const { groupId, userId } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: groupId, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const actorMembership = await groupPolicy.getMembership(room._id, actorId);
  if (!actorMembership || actorMembership.role !== groupPolicy.Roles.OWNER) {
    logger.warn({ groupId: room._id, actorId, reason: 'not_owner' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  if (userId.toString() === actorId.toString()) {
    return res.status(400).json({ error: true, reason: 'ALREADY_OWNER' });
  }

  const targetMembership = await groupPolicy.getMembership(room._id, userId);
  if (!targetMembership) return res.status(404).json({ error: true, reason: 'TARGET_NOT_MEMBER' });

  // CAS on the actor still being OWNER — a losing racer (already
  // transferred by a concurrent request) 409s instead of double-transferring.
  const demoted = await GroupMember.findOneAndUpdate(
    { group: room._id, user: actorId, role: groupPolicy.Roles.OWNER },
    { $set: { role: groupPolicy.Roles.ADMIN, updatedAt: new Date() } },
    { new: true },
  );
  if (!demoted) return res.status(409).json({ error: true, reason: 'OWNERSHIP_CHANGED' });

  await GroupMember.updateOne(
    { group: room._id, user: userId },
    { $set: { role: groupPolicy.Roles.OWNER, updatedAt: new Date() } },
  );
  await Room.updateOne({ _id: room._id }, { $set: { ownerId: userId } });
  await GroupAuditLog.create({
    group: room._id, actor: actorId, action: 'ownership_transferred', target: userId,
  });

  logger.info({ groupId: room._id, previousOwnerId: actorId, newOwnerId: userId }, 'group_ownership_transferred');
  store.io.to(`group:${room._id}`).emit('group:ownership:transferred', { groupId: room._id, newOwnerId: userId });

  res.status(200).json({ status: 'success' });
};
