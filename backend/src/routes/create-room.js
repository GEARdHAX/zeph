const Message = require('../models/Message');
const Room = require('../models/Room');
const xss = require('xss');
const { authorizeAction, Actions, Decisions } = require('../authorization/policy');

module.exports = async (req, res, next) => {
  let { counterpart } = req.fields;

  const authz = await authorizeAction({ actor: req.user.id, target: counterpart, action: Actions.START_CONVERSATION });
  if (authz.decision !== Decisions.ALLOW) return res.status(403).json({ error: true, reason: authz.reason });

  const findMessagesAndEmit = (room) => {
    Message.find({ room: room._id })
      .sort({ _id: -1 })
      .limit(50)
      .populate({
        path: 'author',
        select: '-email -password -friends -__v',
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
            select: '-email -password -friends -__v',
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
                people: room.people,
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

  Room.findOne({
    people: { $all: [req.user.id, counterpart] },
    isGroup: false,
  })
    .populate({
      path: 'people',
      select: '-email -password -friends -__v',
      populate: [
        {
          path: 'picture',
        },
      ],
    })
    .exec((err, room) => {
      if (err) return res.status(500).json({ error: true });
      if (room) {
        findMessagesAndEmit(room);
      } else {
        Room({ people: [req.user.id, counterpart], isGroup: false })
          .save()
          .then((room) => {
            Room.findOne({ _id: room._id })
              .populate('people')
              .then((room) => {
                findMessagesAndEmit(room);
              });
          });
      }
    });
};
