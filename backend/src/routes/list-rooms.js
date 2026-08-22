const Room = require('../models/Room');
const User = require('../models/User');
const ConversationUserState = require('../models/ConversationUserState');
const { isPrivileged } = require('../authorization/policy');
const attachBlockState = require('../utils/attachBlockState');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

module.exports = async (req, res, next) => {
  let { limit } = req.fields;

  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  // Hidden (vaulted) and per-user-deleted conversations are excluded from
  // the normal inbox entirely — not filtered client-side, so their
  // existence/preview/unread state can never leak through this response.
  const excludedStates = await ConversationUserState.find({
    user: req.user.id,
    $or: [{ isHidden: true }, { deletedAt: { $ne: null } }],
  });
  const excludedIds = excludedStates.map((s) => s.conversation);

  // Admin privacy boundary — a 1:1 DM with a privileged account must never
  // appear in the inbox listing for a standard caller. Scoped to non-group
  // rooms only (see roomHasBoundaryViolation.js / DECISIONS.md — group
  // membership is exempt). Caller's own privileged-ness short-circuits the
  // whole check: admins see everyone, including each other.
  let boundaryExcludedIds = [];
  if (!isPrivileged(req.user)) {
    const privilegedIds = await User.find({ level: { $ne: 'standard' } }).distinct('_id');
    if (privilegedIds.length) {
      const boundaryRooms = await Room.find({
        isGroup: false,
        people: { $in: [req.user.id] },
        $and: [{ people: { $in: privilegedIds } }],
      }).distinct('_id');
      boundaryExcludedIds = boundaryRooms;
    }
  }

  Room.find({
    people: { $in: [req.user.id] },
    _id: { $nin: [...excludedIds, ...boundaryExcludedIds] },
    $or: [
      {
        lastMessage: { $ne: null },
      },
      {
        isGroup: true,
      },
    ],
  })
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
    .limit(limit)
    .exec(async (err, rooms) => {
      if (err) return res.status(500).json({ error: true });
      // Built as plain objects, NOT reassigned onto each room's `people`
      // path — a live Mongoose document's `people` schema path is typed as
      // ObjectId refs, so setting it back to an array of plain objects
      // gets silently cast back down to bare ObjectIds by Mongoose on
      // serialization (verified empirically: `people` came back over the
      // wire as raw id strings despite this map running first, breaking
      // every DM row in the sidebar). See DECISIONS.md D-036.
      const sanitizedRooms = await Promise.all(rooms.map(async (room) => {
        const sanitizedPeople = room.people.map((person) => {
          const obj = person.toObject ? person.toObject() : person;
          delete obj.level;
          return obj;
        });
        return {
          ...room.toObject(),
          people: await attachBlockState(sanitizedPeople, req.user.id),
        };
      }));
      res.status(200).json({ limit, rooms: sanitizedRooms });
    });
};
