const Message = require('../models/Message');
const Room = require('../models/Room');
const User = require('../models/User');
const ConversationUserState = require('../models/ConversationUserState');
const store = require('../store');
const xss = require('xss');
const { authorizeAction, Actions, Decisions } = require('../authorization/policy');
const roomHasBoundaryViolation = require('../utils/roomHasBoundaryViolation');
const groupPolicy = require('../authorization/groupPolicy');
const logger = require('../logger');

module.exports = async (req, res, next) => {
  const {
    roomID, content, type, fileID, mediaID,
  } = req.fields;
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
  // unchanged from before the authorization policy existed. For groups,
  // GroupMember is the source of truth (not the Room.people cache), and
  // send permission is capability-gated — see groupPolicy.js, DECISIONS.md D-035.
  if (room.isGroup) {
    const membership = await groupPolicy.getMembershipWithFallback(room._id, authorID);
    if (!membership || !groupPolicy.hasCapability(membership.role, groupPolicy.Capabilities.SEND_MESSAGE)) {
      return res.status(403).json({ error: true });
    }

    // Slow mode — OWNER/ADMIN bypass (a moderator shouldn't be able to lock
    // themselves out mid-incident, matches every mainstream chat app's
    // convention). settings is Mixed/unset for every group that hasn't
    // configured slow mode, so the falsy check covers both "never set" and
    // explicitly disabled (0).
    const slowModeSeconds = room.settings && room.settings.slowModeSeconds;
    const isModerator = membership.role === groupPolicy.Roles.OWNER || membership.role === groupPolicy.Roles.ADMIN;
    if (slowModeSeconds && !isModerator) {
      const lastMessage = await Message.findOne({ room: room._id, author: authorID })
        .sort({ _id: -1 })
        .select('date');
      if (lastMessage && Date.now() - new Date(lastMessage.date).getTime() < slowModeSeconds * 1000) {
        return res.status(429).json({ error: true, reason: 'SLOW_MODE' });
      }
    }
  } else {
    const isMember = room.people.some((person) => person.toString() === authorID.toString());
    if (!isMember) {
      return res.status(403).json({ error: true });
    }
  }

  // Admin privacy boundary — independent of the read-path gates
  // (join-room/get-room/list-rooms), since a room id could be sent to
  // directly without ever going through those. See DECISIONS.md.
  const boundaryViolation = await roomHasBoundaryViolation({
    room, callerID: authorID, callerLevel: req.user.level,
  });
  if (boundaryViolation) {
    return res.status(404).json({ error: true });
  }

  // Block enforcement only applies to 1:1 DMs — a block is a relationship
  // between two people, not a group-membership/moderation concern, so it
  // doesn't reach into an existing group conversation (see policy.js).
  if (!room.isGroup) {
    const other = room.people.find((person) => person.toString() !== authorID.toString());
    if (other) {
      const otherUser = await User.findById(other).select('level accountStatus');
      // Recipient's account no longer exists (hard-deleted) or was
      // deactivated — distinct from "blocked"/"admin_boundary", same
      // generic reason for both so neither case is distinguishable from
      // the other (anti-enumeration, same posture as admin_boundary).
      if (!otherUser || otherUser.accountStatus === 'DELETED') {
        return res.status(404).json({ error: true, reason: 'recipient_unavailable' });
      }
      if (otherUser.accountStatus === 'DEACTIVATED') {
        return res.status(403).json({ error: true, reason: 'recipient_unavailable' });
      }
      const authz = await authorizeAction({
        actor: authorID,
        target: other,
        action: Actions.SEND_MESSAGE,
        actorLevel: req.user.level,
        targetLevel: otherUser && otherUser.level,
      });
      if (authz.decision !== Decisions.ALLOW) {
        // Never leak the admin_boundary reason string — see DECISIONS.md.
        // (Also defense-in-depth here: roomHasBoundaryViolation above
        // already 404s a boundary-violating room before this ever runs.)
        if (authz.reason === 'admin_boundary') return res.status(404).json({ error: true });
        return res.status(403).json({ error: true, reason: authz.reason });
      }
    }
  }

  Message({
    room: roomID,
    author: authorID,
    content: xss(content),
    type,
    file: fileID,
    media: mediaID,
  })
    .save()
    .then((message) => {
      Message.findById(message._id)
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
                //
                // deletedBefore is intentionally NOT cleared here (unlike
                // deletedAt) — restoring the conversation to someone's inbox
                // must only reveal NEW activity from this point forward, not
                // silently resurrect the full pre-delete history. See
                // ConversationUserState's model comment and DECISIONS.md.
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
