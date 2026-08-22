const Room = require('../models/Room');
const User = require('../models/User');
const GroupMember = require('../models/GroupMember');
const xss = require('xss');
const logger = require('../logger');

// Groups are explicitly exempt from the admin-privacy-boundary — group
// membership is a shared-space model, not a discovery surface, so a
// privileged account can legitimately be a group member (see DECISIONS.md).
//
// Create Room(isGroup:true) + GroupMember(OWNER) for the creator +
// GroupMember(MEMBER) for everyone else in one flow. No Mongo transaction —
// docker-compose.yml runs a standalone mongo:6.0 (no replica set), so
// multi-document transactions aren't available; failure after the Room is
// created is handled with a manual compensating delete instead.
module.exports = async (req, res) => {
  const { people, title, picture } = req.fields;
  const ownerId = req.user.id;

  const requestedIds = Array.isArray(people) ? people : [people].filter(Boolean);
  const existingCount = await User.countDocuments({ _id: { $in: requestedIds } });
  if (existingCount !== requestedIds.length) {
    return res.status(400).json({ error: true, reason: 'invalid_members' });
  }

  const memberIds = Array.from(new Set([ownerId.toString(), ...requestedIds.map((id) => id.toString())]));

  const peoplePopulate = {
    path: 'people',
    select: '-email -password -friends -__v -vaultPinHash',
    populate: [{ path: 'picture' }],
  };

  let room;
  try {
    room = await new Room({
      people: memberIds, isGroup: true, title: xss(title), picture, ownerId, privacy: 'PRIVATE',
    }).save();

    await GroupMember.create({ group: room._id, user: ownerId, role: 'OWNER' });
    const otherIds = memberIds.filter((id) => id !== ownerId.toString());
    if (otherIds.length) {
      await GroupMember.insertMany(otherIds.map((id) => ({ group: room._id, user: id, role: 'MEMBER' })));
    }
  } catch (err) {
    if (room) {
      await Room.deleteOne({ _id: room._id }).catch(() => {});
      await GroupMember.deleteMany({ group: room._id }).catch(() => {});
    }
    logger.error({ err, ownerId }, 'Failed to create group');
    return res.status(500).json({ error: true });
  }

  logger.info({ groupId: room._id, ownerId }, 'group_created');
  logger.info({ groupId: room._id, actorId: ownerId, targetId: ownerId, role: 'OWNER' }, 'group_member_added');

  const populatedRoom = await Room.findOne({ _id: room._id }).populate(peoplePopulate);
  const sanitized = populatedRoom.toObject();
  sanitized.people = sanitized.people.map((person) => {
    delete person.level;
    return person;
  });
  sanitized.myRole = 'OWNER';
  res.status(200).json(sanitized);
};
