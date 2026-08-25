const Room = require('../models/Room');
const requireVisibleConversation = require('../utils/requireVisibleConversation');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const attachBlockState = require('../utils/attachBlockState');
const { hasValidVaultToken } = require('../vault/vaultToken');
const groupPolicy = require('../authorization/groupPolicy');

module.exports = async (req, res, next) => {
  let { id } = req.fields;

  const visibility = await requireVisibleConversation({
    roomID: id,
    userID: req.user.id,
    hasVaultAuth: hasValidVaultToken(req),
  });
  if (!visibility.ok) {
    return res.status(visibility.status).json({ error: true, reason: visibility.reason });
  }

  Room.findOne({ _id: id })
    .sort({ lastUpdate: -1 })
    .populate([{ path: 'picture', strictPopulate: false }])
    .populate({
      path: 'people',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: {
        path: 'picture',
      },
    })
    .populate('lastMessage')
    .exec(async (err, room) => {
      if (err || !room || room.disabledAt) return res.status(404).json({ error: true });

      // A former group member (removed/banned/left) keeps read access to
      // history they already have — only a current member gets the
      // defense-in-depth GroupMember re-check below. See canReadRoomHistory.
      const isCurrentMember = room.people.some((person) => person._id.toString() === req.user.id.toString());
      const canRead = isCurrentMember
        || (room.isGroup && await groupPolicy.wasEverMember(room._id, req.user.id));
      if (!canRead) return res.status(403).json({ error: true });

      // Defense in depth for groups: Room.people is a synced cache, but
      // GroupMember is authoritative — re-check it independently in case of
      // drift. See DECISIONS.md D-035. Skipped for a former member — their
      // membership row is intentionally REMOVED/BANNED/LEFT, that's expected.
      if (room.isGroup && isCurrentMember) {
        const membership = await groupPolicy.getMembershipWithFallback(room._id, req.user.id);
        if (!membership) return res.status(404).json({ error: true });
      }

      // Admin privacy boundary — see DECISIONS.md. 404, not 403, so a
      // manipulated/guessed room id for an admin's DM is indistinguishable
      // from one that doesn't exist at all.
      const boundaryViolation = await roomHasBoundaryViolation({
        room, callerID: req.user.id, callerLevel: req.user.level,
      });
      if (boundaryViolation) return res.status(404).json({ error: true });

      // Built as a plain object, NOT reassigned onto `room.people` —
      // `room` is a live Mongoose document and `people`'s schema path is
      // typed as ObjectId refs, so setting it back to an array of plain
      // objects gets silently cast back down to bare ObjectIds by
      // Mongoose on serialization (verified empirically: `people` came
      // back over the wire as raw id strings despite this map running
      // first). See DECISIONS.md D-035/D-036.
      const sanitizedPeople = room.people.map((person) => {
        const obj = person.toObject ? person.toObject() : person;
        delete obj.level;
        return obj;
      });

      const accessRevoked = await groupPolicy.getAccessRevokedInfo(room, req.user.id, isCurrentMember);
      const joinInfo = isCurrentMember ? await groupPolicy.getJoinInfo(room, req.user.id) : undefined;

      const sanitizedRoom = {
        ...room.toObject(),
        people: await attachBlockState(sanitizedPeople, req.user.id),
        ...(accessRevoked ? { accessRevoked } : {}),
        ...(joinInfo ? { myJoinInfo: joinInfo } : {}),
      };

      res.status(200).json({ room: sanitizedRoom });
    });
};
