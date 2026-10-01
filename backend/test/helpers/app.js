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
// Never let tests touch a real external Redis for BullMQ/Socket.IO adapter
// (both read store.config.redisUrl) — same reasoning as stubbing store.io
// below: tests must be hermetic and never depend on/pollute real infra. A
// dedicated test (queues/groupCleanup*.test.js) exercises the actual
// Redis-backed behavior in isolation with its own explicit connection.
//
// rateLimitRedisUrl is the one exception, deliberately NOT null here: every
// token-bucket-rate-limited route (lib/createTokenBucketLimiter.js) fails
// CLOSED with no Redis — unlike every other optional Redis-backed feature
// in this codebase, a request through buildApp() needs real rate-limiting
// infrastructure to reach its handler at all. Falls back to null (fails
// closed, same as production with no Redis configured) when REDIS_URL
// genuinely isn't set, e.g. a CI environment without the secret — tests
// that specifically need to exercise that fail-closed path override this
// back to null themselves (see message-send-rate-limit.test.js's
// dedicated "no Redis configured" describe block).
store.config = { ...config, redisUrl: null, rateLimitRedisUrl: process.env.REDIS_URL || null };
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

        // Mirrors init.js's real JWT strategy exactly — a suspended
        // (DEACTIVATED) or DELETED account must lose access on its very
        // next request, not just its next login.
        if (user.accountStatus === 'DEACTIVATED' || user.accountStatus === 'DELETED') {
          return done(null, false);
        }

        if (payload.deviceId) {
          const session = await Session.findById(payload.deviceId);
          if (!session || session.revokedAt) return done(null, false);
          // Mirrors init.js's real JWT strategy exactly (Phase 2 addition —
          // see its own comment) — without this, req.user.deviceId is
          // always undefined in every test using buildApp(), which means
          // Zero Trust's session-resolution path (services/zeroTrust/
          // sessionContext.js's resolveSession) can never actually find a
          // Session even when tokenForDevice() below creates one and embeds
          // its id in the JWT. Tests that need REAL known-device/session-age
          // behavior (not just the no-session fallback) depend on this.
          user.deviceId = payload.deviceId;
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
