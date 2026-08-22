const User = require('../models/User');
const Room = require('../models/Room');
const store = require('../store');
const logger = require('../logger');

module.exports = (req, res, next) => {
  let { imageID } = req.fields;

  logger.info({ userId: req.user.id }, 'Changing profile picture');

  // "Remove picture" calls this route with no imageID at all — {$set:
  // {picture: undefined}} is a documented Mongoose/MongoDB no-op (the key
  // is stripped from the update entirely), so removal never actually
  // persisted; it only ever appeared to work because the frontend
  // optimistically cleared its own local copy. $unset is what's needed to
  // actually clear the field.
  const update = imageID ? { $set: { picture: imageID } } : { $unset: { picture: 1 } };

  User.findOneAndUpdate({ _id: req.user.id }, update, { new: true })
    .populate([{ path: 'picture', strictPopulate: false }])
    .exec(async (err, user) => {
      if (err) return res.status(500).json({ error: true });

      // Every other person sharing a room (1:1 or group) with this user has
      // the OLD picture cached in their already-open state.io.room/rooms —
      // this route previously only updated the caller's own document with
      // no notification at all, so a picture change/removal never reflected
      // for anyone already looking at a conversation with them until they
      // manually reopened it. Same "notify every room this user is in"
      // shape as forceLeaveGroupRoom/cleanupDeletedUser's room enumeration.
      try {
        const rooms = await Room.find({ people: req.user.id }).select('_id people');
        rooms.forEach((room) => {
          room.people.forEach((personId) => {
            if (personId.toString() === req.user.id.toString()) return;
            store.io.to(personId.toString()).emit('user-profile-updated', {
              userId: req.user.id, picture: user.picture || null,
            });
          });
        });
      } catch (notifyErr) {
        logger.warn({ err: notifyErr, userId: req.user.id }, 'Failed to notify conversation partners of picture change');
      }

      res.status(200).json(user.picture);
    });
};
