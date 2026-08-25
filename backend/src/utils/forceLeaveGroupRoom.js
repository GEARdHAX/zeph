const store = require('../store');

// Reaches every currently-connected socket for a user (store.socketsByUserID
// is already an array per user — supports multiple tabs/devices, see
// init.js) and makes each one leave the group's Socket.IO room. Called
// synchronously right after the GroupMember row is deactivated in
// members-remove.js/members-ban.js/leave.js — DB write first, then
// force-leave, so a removed member's socket can never receive another
// group broadcast for a room they no longer belong to, even without
// reconnecting.
//
// reason distinguishes 'removed' (members-remove.js, self-leave) from
// 'banned' (members-ban.js) — the target's own client needs to know which
// happened (a ban additionally means "can't rejoin"), not just that they
// lost access. groupName/actorName are included so the client can show
// "Removed by <name>" inline without an extra round trip, since by the
// time this fires the target can no longer call any group:* read route to
// look either up themselves.
const forceLeaveGroupRoom = (userId, groupId, {
  reason = 'removed', groupName = null, actorName = null, self = true,
} = {}) => {
  const sockets = store.socketsByUserID[userId] || [];
  const roomName = `group:${groupId}`;
  sockets.forEach((socket) => {
    socket.leave(roomName);
    socket.emit('group:member:removed', {
      groupId, userId, self, reason, groupName, actorName,
    });
  });
};

module.exports = forceLeaveGroupRoom;
