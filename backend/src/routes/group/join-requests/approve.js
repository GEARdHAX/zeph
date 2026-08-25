const Room = require('../../../models/Room');
const User = require('../../../models/User');
const GroupMember = require('../../../models/GroupMember');
const GroupAuditLog = require('../../../models/GroupAuditLog');
const groupPolicy = require('../../../authorization/groupPolicy');
const broadcastToGroup = require('../../../utils/broadcastToGroup');
const postSystemMessage = require('../../../utils/postSystemMessage');
const unhideConversationForUser = require('../../../utils/unhideConversationForUser');
const logger = require('../../../logger');

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
    {
      $set: {
        status: 'ACTIVE', active: true, updatedAt: new Date(), joinedVia: 'JOIN_REQUEST', invitedBy: actorId,
      },
    },
    { new: true },
  );
  if (!updated) return res.status(409).json({ error: true, reason: 'REQUEST_NOT_PENDING' });

  await Room.updateOne({ _id: room._id }, { $addToSet: { people: userId } });
  await unhideConversationForUser(room._id, userId);
  await GroupAuditLog.create({
    group: room._id, actor: actorId, action: 'request_approved', target: userId,
  });

  logger.info({ groupId: room._id, actorId, targetId: userId }, 'group_join_request_approved');
  // room.people is the pre-approval list (before $addToSet above) — the
  // newly-approved user is notified too, via the same per-user delivery,
  // since they aren't in that list yet.
  const recipientIds = [...room.people, userId];
  broadcastToGroup(recipientIds, 'group:member:added', { groupId: room._id, userId, role: updated.role });

  const [approver, joiner] = await Promise.all([
    User.findById(actorId).select('firstName lastName username'),
    User.findById(userId).select('firstName lastName username'),
  ]);
  const approverName = approver ? `${approver.firstName || ''} ${approver.lastName || ''}`.trim() || approver.username : null;
  const joinerName = joiner ? `${joiner.firstName || ''} ${joiner.lastName || ''}`.trim() || joiner.username : 'A member';
  await postSystemMessage(
    room._id,
    approverName ? `${joinerName} joined via request, approved by ${approverName}` : `${joinerName} joined via request`,
    recipientIds,
  ).catch((err) => logger.warn({ err, groupId: room._id }, 'Failed to post join-request-approved system message'));

  res.status(200).json({ status: 'success' });
};
