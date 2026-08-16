const Session = require('../../models/Session');
const { ExtractJwt } = require('passport-jwt');
const jwt = require('jsonwebtoken');

module.exports = async (req, res, next) => {
  const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  const decoded = token ? jwt.decode(token) : null;
  const currentDeviceId = decoded ? decoded.deviceId : null;

  const sessions = await Session.find({ user: req.user.id, revokedAt: null }).sort({ lastSeenAt: -1 });

  res.status(200).json({
    sessions: sessions.map((s) => ({
      id: s._id,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      isCurrent: currentDeviceId != null && s._id.toString() === currentDeviceId.toString(),
    })),
  });
};
