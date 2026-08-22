const store = require('../store');
const logger = require('../logger');
const { broadcastPresence } = require('../presence');

module.exports = (socket, data) => {
  let { status } = data;
  if (store.onlineUsers.get(socket).status === 'busy') return;
  store.onlineUsers.delete(socket);
  store.onlineUsers.set(socket, {
    id: socket.decoded_token.id, status: status || 'online', level: socket.decoded_token.level,
  });
  broadcastPresence().catch((err) => logger.error({ err }, 'Failed to broadcast presence'));
};
