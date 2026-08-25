const Room = require('../../models/Room');
const GroupMember = require('../../models/GroupMember');
const GroupAuditLog = require('../../models/GroupAuditLog');
const groupPolicy = require('../../authorization/groupPolicy');
const broadcastToGroup = require('../../utils/broadcastToGroup');
const logger = require('../../logger');

const VALID_ROLES = ['ADMIN', 'MEMBER'];

// Promote/demote ADMIN<->MEMBER. Only OWNER holds MANAGE_ADMINS.
// Compare-and-swap on the expected current role handles simultaneous role
// changes safely — a losing racer's expected role no longer matches and it
// cleanly conflicts instead of silently overwriting.
module.exports = async (req, res) => {
  const { id, userId, role } = req.fields;
  const actorId = req.user.id;

  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: true });

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const actorMembership = await groupPolicy.getMembership(room._id, actorId);
  if (!actorMembership) return res.status(404).json({ error: true });

  const targetMembership = await groupPolicy.getMembership(room._id, userId);
  if (!targetMembership) return res.status(404).json({ error: true });

  if (!groupPolicy.hasCapability(actorMembership.role, groupPolicy.Capabilities.MANAGE_ADMINS)
    || !groupPolicy.canChangeRole({ actorRole: actorMembership.role, targetRole: targetMembership.role, newRole: role })) {
    logger.warn({ groupId: room._id, actorId, targetId: userId, reason: 'role_hierarchy' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  const updated = await GroupMember.findOneAndUpdate(
    { _id: targetMembership._id, role: targetMembership.role },
    { $set: { role, updatedAt: new Date() } },
    { new: true },
  );
  if (!updated) {
    // Lost the compare-and-swap race — target's role already changed since
    // we read it. Not a server error, just a stale-state conflict.
    return res.status(409).json({ error: true, reason: 'role_changed' });
  }

  await GroupAuditLog.create({
    group: room._id,
    actor: actorId,
    action: 'role_changed',
    target: userId,
    metadata: { oldRole: targetMembership.role, newRole: role },
  });

  logger.info({
    groupId: room._id, actorId, targetId: userId, oldRole: targetMembership.role, newRole: role,
  }, 'group_role_changed');
  broadcastToGroup(room.people, 'group:member:role-updated', { groupId: room._id, userId, role }, { excludeUserId: actorId });

  res.status(200).json({ status: 'success', role });
};
