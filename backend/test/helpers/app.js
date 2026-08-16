process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-for-jest-only';

const express = require('express');
const passport = require('passport');
const { Strategy, ExtractJwt } = require('passport-jwt');
const formidableMiddleware = require('express-formidable');
const jwt = require('jsonwebtoken');
const store = require('../../src/store');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const config = require('../../config');
const router = require('../../src/routes');

// Minimal stand-in for socket.io so routes that call store.io.to(...).emit(...) don't crash in tests.
store.io = {
  to: () => ({ emit: () => {} }),
  emit: () => {},
};
store.config = config;
store.connected = true;

passport.use(
  'jwt',
  new Strategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.secret,
    },
    async (payload, done) => {
      try {
        const user = await User.findById(payload.id);
        if (!user) return done(null, false);

        if (payload.deviceId) {
          const session = await Session.findById(payload.deviceId);
          if (!session || session.revokedAt) return done(null, false);
        }

        return done(null, user);
      } catch (err) {
        return done(err, false);
      }
    },
  ),
);

const buildApp = () => {
  const app = express();
  app.use(formidableMiddleware());
  app.use(passport.initialize());
  app.use('/api', router);
  return app;
};

const tokenFor = (user) => jwt.sign({ id: user._id.toString(), email: user.email }, config.secret, { expiresIn: '1h' });

// Real device-session flow: creates a Session doc first, embeds its id as
// deviceId — mirrors what src/routes/login.js does on real login.
const tokenForDevice = async (user, userAgent = 'jest-test-agent') => {
  const session = await Session.create({ user: user._id, userAgent });
  const token = jwt.sign(
    { id: user._id.toString(), email: user.email, deviceId: session._id.toString() },
    config.secret,
    { expiresIn: '1h' },
  );
  return { token, session };
};

module.exports = { buildApp, tokenFor, tokenForDevice };
