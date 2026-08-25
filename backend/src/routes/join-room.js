const Message = require('../models/Message');
const Room = require('../models/Room');
const ConversationUserState = require('../models/ConversationUserState');
const logger = require('../logger');
const sanitizeDeletedMessage = require('../utils/sanitizeDeletedMessage');
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

  // Delete-history cutoff — a restored (delete-then-new-activity)
  // conversation only shows messages from this point forward for THIS
  // user. See ConversationUserState's model comment and DECISIONS.md.
  const conversationState = await ConversationUserState.findOne({ conversation: id, user: req.user.id }).select('deletedBefore');
  const deletedBefore = conversationState && conversationState.deletedBefore;

  const findMessagesAndEmit = (room, accessRevoked, joinInfo) => {
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
      .populate([{ path: 'media', strictPopulate: false }])
      .lean()
      .then((messages) => {
        messages.reverse();
        // Legacy image messages (type:'image') AND every new-format media
        // message (type:'file' with a media ref, from upload-media.js) —
        // previously this only ever queried type:'image', so every
        // new-format video/pdf/document/audio attachment was invisible in
        // the conversation's Media tab despite rendering fine in the chat
        // itself. `media: { $ne: null }` scopes the type:'file' half to
        // genuinely new-format attachments, excluding legacy type:'file'
        // messages (message.file, no thumbnail-worthy preview) which the
        // Media tab never showed before either.
        Message.find({
          room: room._id,
          $or: [{ type: 'image' }, { type: 'file', media: { $ne: null } }],
        })
          .sort({ _id: -1 })
          .limit(50)
          .populate({
            path: 'author',
            select: '-email -password -friends -__v -vaultPinHash',
            populate: {
              path: 'picture',
            },
          })
          .populate([{ path: 'media', strictPopulate: false }])
          .then((rawImages) => {
            // media: { $ne: null } above only checks the raw ObjectId ref —
            // if the referenced Media document was since deleted, Mongoose
            // populates it back as null, leaving a message with no usable
            // preview data at all (blank "File / Unknown size" card, no
            // working download URL). Drop those rather than show a dead
            // entry in the Media tab.
            const images = rawImages.filter((m) => m.type === 'image' || m.media);
            res.status(200).json({
              room: {
                _id: room._id,
                people: room.people,
                title: room.title,
                isGroup: room.isGroup,
                lastUpdate: room.lastUpdate,
                lastAuthor: room.lastAuthor,
                lastMessage: room.lastMessage,
                picture: room.picture,
                ownerId: room.ownerId,
                description: room.description,
                privacy: room.privacy,
                ...(accessRevoked ? { accessRevoked } : {}),
                ...(joinInfo ? { myJoinInfo: joinInfo } : {}),
                messages: messages
                  // Own "delete for me" state stays hidden on every fresh load too.
                  .filter((e) => !(e.deletedFor || []).some((uid) => uid.toString() === req.user.id.toString()))
                  .filter((e) => !deletedBefore || new Date(e.date) > deletedBefore)
                  .map((e) => {
                    const message = sanitizeDeletedMessage(e);
                    if (message.author) {
                      return message;
                    } else {
                      return {
                        ...message,
                        author: {
                          firstName: 'Deleted',
                          lastName: 'User',
                        },
                      };
                    }
                  }),
                images,
              },
            });
          });
      });
  };

  Room.findOne({ _id: id })
    .populate([{ path: 'picture', strictPopulate: false }])
    .populate({
      path: 'people',
      select: '-email -tagLine -password -friends -__v -vaultPinHash',
      populate: [
        {
          path: 'picture',
        },
      ],
    })
    .exec(async (err, room) => {
      if (err || !room || room.disabledAt) {
        if (err) logger.error({ err, roomId: id }, 'Failed to look up room for join-room');
        return res.status(404).json({ error: true });
      }
      // A former group member (removed/banned/left) keeps read access to
      // history they already have — matches get-room.js's canReadRoomHistory.
      // The join-room.js response never surfaces GroupMember rows, so
      // isCurrentMember alone (not a fallback membership row) decides
      // whether to reconstruct accessRevoked below.
      const isCurrentMember = room.people.some((person) => req.user.id.toString() === person._id.toString());
      const canRead = isCurrentMember
        || (room.isGroup && await groupPolicy.wasEverMember(room._id, req.user.id));
      if (!canRead) {
        return res.status(404).json({ error: true });
      }

      // Admin privacy boundary — an existing 1:1 DM with a privileged account
      // must 404 exactly like it never existed, not just be blocked at
      // creation time. See DECISIONS.md.
      const boundaryViolation = await roomHasBoundaryViolation({
        room, callerID: req.user.id, callerLevel: req.user.level,
      });
      if (boundaryViolation) {
        return res.status(404).json({ error: true });
      }

      // `level` was selected through for internal use only (nothing above
      // explicitly excludes it) — strip it from every person before this
      // room ever reaches the client, so it can never leak as a side
      // channel even for people/rooms the boundary check itself allows.
      //
      // Built as a plain array on the room object we pass along, NOT
      // reassigned back onto `room.people` — `room` is a live Mongoose
      // document and `people`'s schema path is typed as ObjectId refs, so
      // setting it back to an array of plain objects gets silently CAST
      // back down to bare ObjectIds by Mongoose (verified: room.people
      // serialized as raw id strings over the wire despite this map
      // running first). Passing a plain object with the already-mapped
      // array through `findMessagesAndEmit` instead keeps the real
      // populated data intact.
      const sanitizedPeople = room.people.map((person) => {
        const obj = person.toObject ? person.toObject() : person;
        delete obj.level;
        return obj;
      });
      const peopleWithBlockState = await attachBlockState(sanitizedPeople, req.user.id);

      // Mirrors get-room.js so a former member reopening this room after a
      // fresh page load still sees the composer gated — this is the route
      // the frontend's getRoom() action actually calls (/room/join), not
      // /room/get.
      const accessRevoked = await groupPolicy.getAccessRevokedInfo(room, req.user.id, isCurrentMember);
      // Lets Messages.jsx show "You joined via X, invited by Y" instead of a
      // generic empty state when this member's own history is empty (see
      // getJoinInfo's comment for why that can happen even for an active
      // member). Only meaningful for a current member — a former member gets
      // the accessRevoked banner instead, not this.
      const joinInfo = isCurrentMember ? await groupPolicy.getJoinInfo(room, req.user.id) : undefined;

      findMessagesAndEmit({ ...room.toObject(), people: peopleWithBlockState }, accessRevoked, joinInfo);
    });
};
