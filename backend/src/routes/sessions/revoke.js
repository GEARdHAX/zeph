const Session = require('../../models/Session');
const store = require('../../store');

module.exports = async (req, res, next) => {
  const { id } = req.fields;
  if (!id) return res.status(400).json({ error: true });

  const session = await Session.findOne({ _id: id, user: req.user.id });
  if (!session) return res.status(404).json({ error: true });

  session.revokedAt = new Date();
  await session.save();

  // Disconnect any live socket authenticated under this session right away —
  // otherwise a revoked device stays connected until its next reconnect.
  Object.values(store.sockets || {}).forEach((socket) => {
    if (socket.decoded_token && socket.decoded_token.deviceId === id) {
      socket.emit('unauthorized', { message: 'session_revoked' });
      socket.disconnect(true);
    }
  });

  res.status(200).json({ ok: true });
};
