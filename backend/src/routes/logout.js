const Session = require('../models/Session');
const { ExtractJwt } = require('passport-jwt');
const jwt = require('jsonwebtoken');

module.exports = async (req, res, next) => {
  const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  const decoded = token ? jwt.decode(token) : null;

  if (decoded && decoded.deviceId) {
    await Session.updateOne({ _id: decoded.deviceId, user: req.user.id }, { $set: { revokedAt: new Date() } });
  }

  res.status(200).json({ ok: true });
};
