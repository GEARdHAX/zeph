// Strips tombstoned-message content from plain (lean) objects — the
// Message model's own toJSON transform (models/Message.js) already handles
// this for real Mongoose documents serialized via res.json(), but .lean()
// queries return plain objects that never go through toJSON. Routes using
// .lean() (more-messages.js, sync-messages.js, join-room.js) map their
// results through this instead of duplicating the same check three times.
const sanitizeDeletedMessage = (message) => {
  if (!message.deletedForEveryone) return message;
  return { ...message, content: null, file: null };
};

module.exports = sanitizeDeletedMessage;
