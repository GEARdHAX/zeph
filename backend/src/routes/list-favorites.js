const User = require('../models/User');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const attachBlockState = require('../utils/attachBlockState');

module.exports = async (req, res, next) => {
  User.findOne({ _id: req.user.id })
    .populate({
      path: 'favorites',
      populate: [
        {
          path: 'people',
          select: '-email -password -friends -__v -vaultPinHash',
          populate: {
            path: 'picture',
          },
        },
        {
          path: 'lastMessage',
        },
        {
          path: 'picture',
        },
      ],
    })
    .exec(async (err, user) => {
      if (err) return res.status(500).json({ error: true });
      if (!user) return res.status(200).json({ favorites: [] });

      // Admin privacy boundary — a favorited 1:1 DM with a privileged
      // account must not resurface here even if it's still in the raw
      // favorites array. See DECISIONS.md.
      const visibleFavorites = [];
      for (const room of user.favorites) {
        // eslint-disable-next-line no-await-in-loop
        const violation = await roomHasBoundaryViolation({
          room, callerID: req.user.id, callerLevel: req.user.level,
        });
        if (!violation) {
          // Built as a plain object, NOT reassigned onto `room.people` —
          // see DECISIONS.md D-036 (Mongoose casts a plain-object array
          // back down to bare ObjectIds when set on a schema-typed ref
          // path, silently dropping the populated data on serialization).
          const sanitizedPeople = room.people.map((person) => {
            const obj = person.toObject ? person.toObject() : person;
            delete obj.level;
            return obj;
          });
          visibleFavorites.push({
            ...room.toObject(),
            // eslint-disable-next-line no-await-in-loop
            people: await attachBlockState(sanitizedPeople, req.user.id),
          });
        }
      }

      res.status(200).json({ favorites: visibleFavorites });
    });
};
