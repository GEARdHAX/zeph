const Room = require('../../models/Room');
const groupPolicy = require('../../authorization/groupPolicy');

// Group details — non-members get the same 404 as a group that doesn't
// exist (IDOR/anti-enumeration, matching the rest of this codebase's
// convention for room/conversation access).
module.exports = async (req, res) => {
  const { id } = req.fields;

  const room = await Room.findOne({ _id: id, isGroup: true })
    .populate([{ path: 'picture', strictPopulate: false }])
    .catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembership(room._id, req.user.id);
  if (!membership) return res.status(404).json({ error: true });

  res.status(200).json({
    group: {
      _id: room._id,
      name: room.title,
      description: room.description,
      avatar: room.picture,
      ownerId: room.ownerId,
      privacy: room.privacy,
      settings: room.settings,
      memberCount: room.people.length,
      createdAt: room._id.getTimestamp(),
      myRole: membership.role,
    },
  });
};
