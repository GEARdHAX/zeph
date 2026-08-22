const Room = require('../../models/Room');
const groupPolicy = require('../../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../../utils/forceLeaveGroupRoom');
const logger = require('../../logger');
const store = require('../../store');

// Owner-only deletion lifecycle: mark disabled (immediate access revocation
// for every route, since every group route already 404s on room.disabledAt)
// -> force every connected member off the socket room -> notify -> enqueue
// BullMQ cleanup (wired in Phase 4; a null/no-op enqueue here until then —
// see queues/groupCleanup.js). No synchronous cascade-delete of messages.
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

  room.people.forEach((personId) => forceLeaveGroupRoom(personId.toString(), room._id.toString()));
  store.io.to(`group:${room._id}`).emit('group:updated', { groupId: room._id, disabled: true });

  logger.info({ groupId: room._id, ownerId: actorId }, 'group_delete_requested');

  let enqueueGroupCleanup;
  try {
    ({ enqueueGroupCleanup } = require('../../queues/groupCleanup'));
  } catch (e) {
    // queues/groupCleanup.js doesn't exist until Phase 4 — group is already
    // fully inaccessible via the disabledAt check above regardless.
  }
  if (enqueueGroupCleanup) enqueueGroupCleanup(room._id.toString());

  res.status(200).json({ status: 'success' });
};
