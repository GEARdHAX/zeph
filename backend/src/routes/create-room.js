const Message = require('../models/Message');
const Room = require('../models/Room');
const User = require('../models/User');
const xss = require('xss');
const { authorizeAction, Actions, Decisions } = require('../authorization/policy');

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

  Room.findOne({
    people: { $all: [req.user.id, counterpart] },
    isGroup: false,
  })
    .populate(peoplePopulate)
    .exec((err, room) => {
      if (err) return res.status(500).json({ error: true });
      if (room) {
        findMessagesAndEmit(room);
      } else {
        Room({ people: [req.user.id, counterpart], isGroup: false })
          .save()
          .then((room) => {
            // Same field exclusion as the existing-room lookup above — this
            // path previously populated with NO select at all, leaking the
            // full raw User document (password hash included) for a
            // brand-new room's first response.
            Room.findOne({ _id: room._id })
              .populate(peoplePopulate)
              .then((room) => {
                findMessagesAndEmit(room);
              });
          });
      }
    });
};
