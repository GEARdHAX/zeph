const Message = require('../models/Message');
const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const store = require('../store');
const xss = require('xss');
const { authorizeAction, Actions, Decisions } = require('../authorization/policy');
const logger = require('../logger');

module.exports = async (req, res, next) => {
  const { roomID, content, type, fileID } = req.fields;
  const authorID = req.user.id;

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return res.status(404).json({ error: true });
  }

  if (!room) {
    return res.status(404).json({ error: true });
  }

  // Conversation access is membership, not friendship — this check is
  // unchanged from before the authorization policy existed.
  const isMember = room.people.some((person) => person.toString() === authorID.toString());
  if (!isMember) {
    return res.status(403).json({ error: true });
  }

  // Block enforcement only applies to 1:1 DMs — a block is a relationship
  // between two people, not a group-membership/moderation concern, so it
  // doesn't reach into an existing group conversation (see policy.js).
  if (!room.isGroup) {
    const other = room.people.find((person) => person.toString() !== authorID.toString());
    if (other) {
      const authz = await authorizeAction({ actor: authorID, target: other, action: Actions.SEND_MESSAGE });
      if (authz.decision !== Decisions.ALLOW) return res.status(403).json({ error: true, reason: authz.reason });
    }
  }

  Message({
    room: roomID,
    author: authorID,
    content: xss(content),
    type,
    file: fileID,
  })
    .save()
    .then((message) => {
      Message.findById(message._id)
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
        .then((message) => {
          Room.findByIdAndUpdate(roomID, {
            $set: { lastUpdate: message.date, lastMessage: message._id, lastAuthor: authorID },
          })
            .then((room) => {
              room.people.forEach((person) => {
                const myUserID = req.user.id;
                const personUserID = person.toString();

                // WhatsApp-like reappearance: sending OR receiving a message
                // un-deletes the conversation back into that person's inbox
                // — "delete" means "delete my current view," not a
                // permanent block (blocking is a separate, explicit
                // action). Applies to the sender too: without this, a user
                // who deletes a conversation and then messages back into it
                // themselves would stay stuck with it hidden from their own
                // inbox despite actively using it. Hidden/vaulted state is
                // untouched here — a vaulted conversation getting a new
                // message stays hidden, it doesn't auto-reveal.
                ConversationUserState.updateOne(
                  { conversation: roomID, user: personUserID, deletedAt: { $ne: null } },
                  { $set: { deletedAt: null } },
                ).catch((err) => {
                  logger.warn({ err, roomID, userId: personUserID }, 'Failed to clear conversation deletedAt on new message');
                });

                if (personUserID !== myUserID) {
                  store.io.to(personUserID).emit('message-in', { status: 200, message, room });
                }
              });
              res.status(200).json({ message, room });
            })
            .catch((err) => {
              return res.status(500).json({ error: true });
            });
        })
        .catch((err) => {
          return res.status(500).json({ error: true });
        });
    })
    .catch((err) => {
      return res.status(500).json({ error: true });
    });
};
