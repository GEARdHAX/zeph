const Relationship = require('../models/Relationship');

// Attaches `blockedByMe`/`blockedMe` booleans onto each person object in a
// room's (already-sanitized, plain-object) people array — every route that
// serves room/people data (get-room, list-rooms, list-favorites, join-room)
// builds that array the same way (see D-036) but none of them expose block
// state, so the frontend has no way to show "Unblock" instead of "Block", or
// to know the online-status it renders is being deliberately hidden by
// presence.js's own block filtering. One query per call covers every person
// in the room, not one query per person.
const attachBlockState = async (people, callerID) => {
  const otherIds = (people || [])
    .map((p) => p._id)
    .filter((id) => id && id.toString() !== callerID.toString());
  if (!otherIds.length) return people;

  const relationships = await Relationship.find({
    status: 'blocked',
    $or: [
      { requester: callerID, recipient: { $in: otherIds } },
      { requester: { $in: otherIds }, recipient: callerID },
    ],
  }).select('requester recipient blockedBy').lean();

  const byOtherId = new Map();
  relationships.forEach((rel) => {
    const otherId = rel.requester.toString() === callerID.toString()
      ? rel.recipient.toString()
      : rel.requester.toString();
    byOtherId.set(otherId, rel.blockedBy.toString());
  });

  return people.map((person) => {
    const blockedBy = byOtherId.get(person._id?.toString());
    if (!blockedBy) return person;
    return {
      ...person,
      blockedByMe: blockedBy === callerID.toString(),
      blockedMe: blockedBy !== callerID.toString(),
    };
  });
};

module.exports = attachBlockState;
