const store = require('../store');

// Delivers a Socket.IO event to every ACTIVE group member, one at a time to
// each person's own room (store.io.to(personId)) — the same delivery
// mechanism message.js already uses and the only one actually wired up:
// every socket auto-joins its own personal room at connect (init.js,
// socket.join(id)), but nothing ever joins a socket into a `group:${id}`
// room, so store.io.to(`group:${id}`).emit(...) has never reached anyone.
// See DECISIONS.md.
//
// memberIds: array of user id strings/ObjectIds — typically Room.people
// (already excludes removed/banned members, since those are $pull'd from
// it) or an explicit list when the caller already has one in hand.
// excludeUserId: optional — skip the actor themselves (they already know
// the result from their own request's response).
const broadcastToGroup = (memberIds, event, payload, { excludeUserId } = {}) => {
  memberIds.forEach((memberId) => {
    const id = memberId.toString();
    if (excludeUserId && id === excludeUserId.toString()) return;
    store.io.to(id).emit(event, payload);
  });
};

module.exports = broadcastToGroup;
