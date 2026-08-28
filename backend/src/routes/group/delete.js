const Room = require('../../models/Room');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const broadcastToGroup = require('../../utils/broadcastToGroup');
const { enqueueGroupCleanup } = require('../../queues/groupCleanup');
const logger = require('../../logger');

// Owner-only deletion lifecycle: mark disabled (immediate access revocation
// for every route, since every group route already 404s on room.disabledAt)
// -> force every connected member off the socket room -> notify -> enqueue
// BullMQ cleanup (24h delay, see queues/groupCleanup.js/groupCleanupWorker.js
// — best-effort, a no-op if Redis isn't configured). No synchronous
// cascade-delete of messages; the group is already fully inaccessible via
// disabledAt regardless of whether/when the cleanup job runs.
module.exports = async (req, res) => {
  const { id } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembership(room._id, actorId);
  if (!membership || membership.role !== groupPolicy.Roles.OWNER) {
    logger.warn({ groupId: room._id, actorId, reason: 'not_owner' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  await Room.updateOne({ _id: room._id }, { $set: { disabledAt: new Date() } });

  room.people
    .filter((personId) => personId.toString() !== actorId.toString())
    .forEach((personId) => forceLeaveGroupRoom(personId.toString(), room._id.toString(), {
      reason: 'deleted', groupName: room.title,
    }));
  broadcastToGroup(room.people, 'group:updated', { groupId: room._id, disabled: true }, { excludeUserId: actorId });

  logger.info({ groupId: room._id, ownerId: actorId }, 'group_delete_requested');

  // Fire-and-forget, matches every other post-response side effect above —
  // the HTTP response below doesn't wait on this. See enqueueGroupCleanup's
  // own comment for why a failed enqueue is logged, not thrown.
  enqueueGroupCleanup(room._id.toString());

  res.status(200).json({ status: 'success' });
};
