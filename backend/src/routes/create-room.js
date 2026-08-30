const Message = require('../models/Message');
const Room = require('../models/Room');
const User = require('../models/User');
const xss = require('xss');
const { authorizeAction, Actions, Decisions } = require('../authorization/policy');
const SecurityEventService = require('../services/securityEventService');
const securityEventContext = require('../utils/securityEventContext');

module.exports = async (req, res, next) => {
  let { counterpart } = req.fields;

  // Existence check on the counterpart (pre-existing gap: this route
  // previously created a room with whatever id the client sent, real user
  // or not) also gets us targetLevel for the admin-privacy-boundary check
  // at zero extra queries. Missing counterpart and admin-boundary violation
  // both resolve to the exact same generic 404 — never distinguishable —
  // see DECISIONS.md.
  const counterpartUser = await User.findById(counterpart).select('_id level');
  if (!counterpartUser) return res.status(404).json({ error: true });

  const authz = await authorizeAction({
    actor: req.user.id,
    target: counterpart,
    action: Actions.START_CONVERSATION,
    actorLevel: req.user.level,
    targetLevel: counterpartUser.level,
  });
  if (authz.decision !== Decisions.ALLOW) {
    SecurityEventService.record({
      type: 'UNAUTHORIZED_ACCESS',
      severity: authz.reason === 'admin_boundary' ? 'high' : 'medium',
      actor: { userId: req.user.id },
      source: securityEventContext(req),
      target: { resource: 'room', action: 'start_conversation' },
      result: 'blocked',
      // reason is recorded even for admin_boundary — the response itself
      // stays the indistinguishable-from-404 shape below (DECISIONS.md),
      // this is server-side-only telemetry, not something the caller sees.
      metadata: { reason: authz.reason },
    });
    // admin_boundary must be indistinguishable from "counterpart doesn't
    // exist" — no reason field, same shape as the !counterpartUser 404
    // above. See DECISIONS.md.
    if (authz.reason === 'admin_boundary') return res.status(404).json({ error: true });
    return res.status(403).json({ error: true, reason: authz.reason });
  }

  const findMessagesAndEmit = (room) => {
    Message.find({ room: room._id })
      .sort({ _id: -1 })
      .limit(50)
      .populate({
        path: 'author',
        select: '-email -password -friends -__v -vaultPinHash',
        populate: [
          {
            path: 'picture',
          },
        ],
      })
      .populate([{ path: 'file', strictPopulate: false }])
      .then((messages) => {
        Message.find({ room: room._id, type: 'image' })
          .sort({ _id: -1 })
          .limit(50)
          .populate({
            path: 'author',
            select: '-email -password -friends -__v -vaultPinHash',
            populate: [
              {
                path: 'picture',
              },
            ],
          })
          .then((images) => {
            messages.reverse();
            const visibleMessages = messages.filter(
              (m) => !m.deletedFor.some((uid) => uid.toString() === req.user.id.toString()),
            );
            res.status(200).json({
              room: {
                _id: room._id,
                people: room.people.map((person) => {
                  const obj = person.toObject ? person.toObject() : person;
                  delete obj.level;
                  return obj;
                }),
                title: xss(room.title),
                isGroup: room.isGroup,
                lastUpdate: room.lastUpdate,
                lastAuthor: room.lastAuthor,
                lastMessage: room.lastMessage,
                messages: visibleMessages,
                images,
              },
            });
          });
      });
  };

  const peoplePopulate = {
    path: 'people',
    select: '-email -password -friends -__v -vaultPinHash',
    populate: [
      {
        path: 'picture',
      },
    ],
  };

  // Canonical sorted-pair key — see Room.js's dmKey comment. Atomic
  // find-or-create via upsert on this unique key closes the race where two
  // concurrent "open chat" requests (e.g. both users clicking into the same
  // new DM at once) previously could both pass a findOne-miss and each
  // .save() their own room, producing two DM rooms for the same pair.
  const dmKey = [req.user.id.toString(), counterpart.toString()].sort().join(':');

  Room.findOneAndUpdate(
    { dmKey },
    { $setOnInsert: { people: [req.user.id, counterpart], isGroup: false, dmKey } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
    .populate(peoplePopulate)
    .exec((err, room) => {
      if (err) {
        // 11000 = the sparse-unique dmKey index caught a genuine concurrent
        // insert that upsert's own atomicity didn't fully prevent (a known
        // MongoDB upsert race under very high concurrency) — the other
        // request's room now exists, so just fetch it instead of erroring.
        if (err.code === 11000) {
          return Room.findOne({ dmKey })
            .populate(peoplePopulate)
            .then((room) => findMessagesAndEmit(room))
            .catch(() => res.status(500).json({ error: true }));
        }
        return res.status(500).json({ error: true });
      }
      findMessagesAndEmit(room);
    });
};
