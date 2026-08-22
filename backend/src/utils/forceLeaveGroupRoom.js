const store = require('../store');

// Reaches every currently-connected socket for a user (store.socketsByUserID
// is already an array per user — supports multiple tabs/devices, see
// init.js) and makes each one leave the group's Socket.IO room. Called
// synchronously right after the GroupMember row is deactivated in
// members-remove.js/leave.js — DB write first, then force-leave, so a
// removed member's socket can never receive another group broadcast for a
// room they no longer belong to, even without reconnecting.
const forceLeaveGroupRoom = (userId, groupId) => {
  const sockets = store.socketsByUserID[userId] || [];
  const roomName = `group:${groupId}`;
  sockets.forEach((socket) => {
    socket.leave(roomName);
    socket.emit('group:member:removed', { groupId, userId, self: true });
  });
};

module.exports = forceLeaveGroupRoom;
