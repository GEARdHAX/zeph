const Message = require('../models/Message');
const Room = require('../models/Room');
const store = require('../store');
const config = require('../../config');
const logger = require('../logger');

module.exports = async (req, res, next) => {
  const { roomID, messageID, forEveryone } = req.fields;
  const userID = req.user.id;

  if (!roomID || !messageID) {
    return res.status(400).json({ error: true });
  }

  let room;
  try {
    room = await Room.findOne({ _id: roomID });
  } catch (e) {
    return res.status(404).json({ error: true });
  }
  if (!room) {
    return res.status(404).json({ error: true });
  }

  const isMember = room.people.some((person) => person.toString() === userID.toString());
  if (!isMember) {
    return res.status(403).json({ error: true });
  }

  let message;
  try {
    message = await Message.findOne({ _id: messageID, room: roomID });
  } catch (e) {
    return res.status(404).json({ error: true });
  }
  if (!message) {
    return res.status(404).json({ error: true });
  }

  const wantsForEveryone = forEveryone === true || forEveryone === 'true';

  if (wantsForEveryone) {
    // Only the author can delete for everyone — a room member deleting
    // someone else's message content for the whole room would be a much
    // bigger authorization hole than IDOR on your own data.
    if (!message.author || message.author.toString() !== userID.toString()) {
      return res.status(403).json({ error: true, reason: 'not_author' });
    }

    // Idempotent: re-deleting an already-tombstoned message is a no-op
    // success, not an error — a second click (network retry, double-tap,
    // two tabs) shouldn't surface a failure for something that's already
    // in the requested end state.
    if (!message.deletedForEveryone) {
      const ageMs = Date.now() - new Date(message.date).getTime();
      if (ageMs > config.messageDeletionWindowMs) {
        return res.status(403).json({ error: true, reason: 'deletion_window_expired' });
      }

      message.deletedForEveryone = true;
      message.deletedAt = new Date();
      message.content = null;
      message.file = null;
      try {
        await message.save();
      } catch (err) {
        logger.error({ err, userId: userID, messageId: messageID }, 'Failed to delete message for everyone');
        return res.status(500).json({ error: true });
      }

      logger.info({ userId: userID, messageId: messageID, roomId: roomID }, 'Message deleted for everyone');

      room.people.forEach((person) => {
        const personUserID = person.toString();
        if (personUserID !== userID.toString()) {
          store.io.to(personUserID).emit('message-deleted', {
            roomID, messageID, forEveryone: true, deletedBy: userID,
          });
        }
      });
    }

    return res.status(200).json({
      status: 'success', messageID, deletedForEveryone: true, deletedAt: message.deletedAt,
    });
  }

  // Delete for me: any room member can hide the message from their own
  // view, regardless of who authored it — same as WhatsApp's own rule.
  // $addToSet keeps this idempotent (already-present userID is a no-op).
  try {
    await Message.updateOne({ _id: messageID }, { $addToSet: { deletedFor: userID } });
  } catch (err) {
    logger.error({ err, userId: userID, messageId: messageID }, 'Failed to delete message for me');
    return res.status(500).json({ error: true });
  }

  // No socket emit here — "delete for me" is single-user local state, not
  // a room-wide event; other participants' views are entirely unaffected.
  // Other DEVICES of the same user still need to hear about it though —
  // targeting the user's own personal room (same pattern message.js uses
  // for delivery) reaches every session/tab/device they're logged into.
  store.io.to(userID.toString()).emit('message-deleted', { roomID, messageID, forEveryone: false });

  res.status(200).json({ status: 'success', messageID, deletedForEveryone: false });
};
