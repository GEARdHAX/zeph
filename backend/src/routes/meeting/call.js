const User = require('../../models/User');
const Room = require('../../models/Room');
const xss = require('xss');
const store = require('../../store');
const logger = require('../../logger');
const roomHasBoundaryViolation = require('../../utils/roomHasBoundaryViolation');
const { authorizeAction, Actions, Decisions } = require('../../authorization/policy');

module.exports = async (req, res, next) => {
  let { roomID, meetingID } = req.fields;

  const user = await User.findOne({ _id: req.user.id }, {
    email: 0, password: 0, friends: 0, __v: 0, vaultPinHash: 0,
  }).populate([
    { path: 'picture', strictPopulate: false },
  ]);

  Room.findOne({ _id: roomID })
    .populate({
      path: 'people',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: [
        {
          path: 'picture',
        },
      ],
    })
    .then(async (room) => {
      if (!room) return res.status(404).json({ error: true });

      const isMember = room.people.some((person) => person._id.toString() === req.user.id.toString());
      if (!isMember) return res.status(403).json({ error: true });

      // Admin privacy boundary — see DECISIONS.md.
      const boundaryViolation = await roomHasBoundaryViolation({
        room, callerID: req.user.id, callerLevel: req.user.level,
      });
      if (boundaryViolation) return res.status(404).json({ error: true });

      // Call authorization moves server-side here — previously a call could
      // be placed to a hard-deleted/deactivated/blocked account with zero
      // server enforcement (the frontend's "offline" check is pure UX, not
      // authorization). Reuses the same "can these two people communicate"
      // rule messaging already enforces (SEND_MESSAGE) rather than inventing
      // a separate PLACE_CALL rule for an identical policy. See DECISIONS.md.
      //
      // Read the OTHER participant's id from the room's raw (unpopulated)
      // people array, not the already-populated `room.people` above —
      // Mongoose's populate() silently DROPS an array entry whose reference
      // no longer resolves (verified: a hard-deleted user's id is removed
      // from the populated array entirely, not left as a dangling
      // unpopulated ObjectId) — looking for "other" in the populated array
      // would therefore never find a hard-deleted recipient at all and
      // silently skip this whole gate.
      if (!room.isGroup) {
        const rawRoom = await Room.findById(roomID).select('people').lean();
        const otherId = (rawRoom?.people || []).map((p) => p.toString()).find((p) => p !== req.user.id.toString());
        if (otherId) {
          const otherUser = await User.findById(otherId).select('level accountStatus');
          if (!otherUser || otherUser.accountStatus === 'DELETED') {
            return res.status(404).json({ error: true, reason: 'recipient_unavailable' });
          }
          if (otherUser.accountStatus === 'DEACTIVATED') {
            return res.status(403).json({ error: true, reason: 'recipient_unavailable' });
          }
          const authz = await authorizeAction({
            actor: req.user.id,
            target: otherId,
            action: Actions.SEND_MESSAGE,
            actorLevel: req.user.level,
            targetLevel: otherUser.level,
          });
          if (authz.decision !== Decisions.ALLOW) {
            if (authz.reason === 'admin_boundary') return res.status(404).json({ error: true });
            return res.status(403).json({ error: true, reason: authz.reason });
          }
        }
      }

      const sanitizedPeople = room.people.map((person) => {
        const obj = person.toObject ? person.toObject() : person;
        delete obj.level;
        return obj;
      });

      sanitizedPeople.forEach((person) => {
        const myUserID = req.user.id;
        const personUserID = person._id.toString();

        if (personUserID !== myUserID) {
          store.io
            .to(personUserID)
            .emit('call', {
              status: 200, room: { ...room.toObject(), people: sanitizedPeople }, meetingID, roomID, caller: req.user.id, counterpart: user,
            });
        }
      });

      res.status(200).json({ ok: true });
    })
    .catch((err) => {
      logger.error({ err, roomId: roomID }, 'Failed to initiate call');
      return res.status(500).json({ error: true });
    });
};
