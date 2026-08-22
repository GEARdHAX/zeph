const Message = require('../models/Message');
const Room = require('../models/Room');
const GroupMember = require('../models/GroupMember');
const groupPolicy = require('../authorization/groupPolicy');
const forceLeaveGroupRoom = require('../utils/forceLeaveGroupRoom');
const logger = require('../logger');
const store = require('../store');

module.exports = async (req, res, next) => {
  let { id } = req.fields;

  let room;
  try {
    room = await Room.findOne({ _id: id });
  } catch (e) {
    return res.status(404).json({ status: 'error', message: 'room not found' });
  }

  if (!room) {
    return res.status(404).json({ status: 'error', message: 'room not found' });
  }

  // isGroup:false (1:1 DM) behavior is completely unchanged below — this
  // branch only exists for groups.
  if (room.isGroup) {
    const membership = await groupPolicy.getMembership(room._id, req.user.id);
    if (!membership) {
      return res.status(403).json({ status: 'error', message: 'not a member of this room' });
    }

    // The OWNER hard-deleting the whole group for everyone (the previous
    // "any member can nuke it" behavior) is no longer allowed via this
    // endpoint — see DECISIONS.md D-035. An owner must use the dedicated
    // delete lifecycle instead.
    if (membership.role === groupPolicy.Roles.OWNER) {
      return res.status(400).json({ error: true, reason: 'owner_must_use_delete_endpoint' });
    }

    // Non-owner "remove room" on a group means "leave the group" — only the
    // caller's own membership is affected, the group and its messages are
    // untouched for everyone else.
    await GroupMember.updateOne({ _id: membership._id }, { $set: { active: false, updatedAt: new Date() } });
    await Room.updateOne({ _id: room._id }, { $pull: { people: req.user.id } });

    forceLeaveGroupRoom(req.user.id.toString(), room._id.toString());

    logger.info({ groupId: room._id, actorId: req.user.id, targetId: req.user.id, selfLeave: true }, 'group_member_removed');
    store.io.to(`group:${room._id}`).emit('group:member:removed', { groupId: room._id, userId: req.user.id, self: true });

    return res.status(200).json({ status: 'success', message: 'left group' });
  }

  const isMember = room.people.some((person) => person.toString() === req.user.id.toString());
  if (!isMember) {
    return res.status(403).json({ status: 'error', message: 'not a member of this room' });
  }

  try {
    await Room.findOneAndDelete({ _id: id });
  } catch (e) {
    return res.status(404).json({ status: 'error', message: 'room not found' });
  }

  try {
    await Message.deleteMany({ room: id });
  } catch (e) {
    return res.status(404).json({ status: 'error', message: 'error while deleting messages' });
  }

  res.status(200).json({ status: 'success', message: 'room deleted' });
};
