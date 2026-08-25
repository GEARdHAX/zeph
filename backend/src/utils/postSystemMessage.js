const Message = require('../models/Message');
const Room = require('../models/Room');
const logger = require('../logger');
const store = require('../store');

// Persists a type:'system' message (no author — Message.author is optional,
// see model) and delivers it exactly like a real user message: same
// Room.lastUpdate/lastMessage/lastAuthor bump, same per-user 'message-in'
// socket delivery message.js already uses (every socket already listens on
// its own personal room — see init.js). This is what makes a moderation
// event ("X was removed by Y") show up inline in the chat feed for every
// member, survive reload/pagination, and appear in the sidebar's last-
// message preview, matching how WhatsApp/Telegram render membership
// changes as regular chat entries rather than a separate notification
// system. See DECISIONS.md.
//
// content is the exact string shown in the chat pill (Message.jsx renders
// type:'system' as a centered pill, not a bubble — no author avatar, no
// delete/copy menu, no read receipts).
// recipientIds: user ids to deliver the live socket event to (typically
// the group's remaining Room.people, since the moderated user themselves
// already gets their own distinct notification via forceLeaveGroupRoom.js
// and isn't a Room.people member by the time this runs).
const postSystemMessage = async (roomId, content, recipientIds) => {
  let message;
  try {
    message = await new Message({
      room: roomId, content, type: 'system',
    }).save();
  } catch (err) {
    logger.error({ err, roomId }, 'Failed to persist system message');
    return null;
  }

  await Room.updateOne(
    { _id: roomId },
    { $set: { lastUpdate: message.date, lastMessage: message._id, lastAuthor: null } },
  ).catch((err) => logger.warn({ err, roomId }, 'Failed to update room lastMessage for system message'));

  recipientIds.forEach((id) => {
    store.io.to(id.toString()).emit('message-in', { status: 200, message, room: { _id: roomId } });
  });

  return message;
};

module.exports = postSystemMessage;
