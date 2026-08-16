const store = require('./store');
const logger = require('./logger');
const events = require('./events');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const router = require('./routes');
const formidableMiddleware = require('express-formidable');
const mongoose = require('mongoose');
const User = require('./models/User');
const Session = require('./models/Session');
const argon2 = require('argon2');
const passport = require('passport');
const { Strategy, ExtractJwt } = require('passport-jwt');
const { AsyncNedb } = require('nedb-async');
// mediasoup is NOT imported here — it is passed in as a flag from index.js
// so that Glitch deployments (no native build tools) never attempt to load it.
const Meeting = require('./models/Meeting');

// Wires the Socket.IO connection/auth lifecycle onto store.io. Split out from the default
// export so tests can boot just the socket layer without also connecting to Mongo / mounting
// the full HTTP router (see test/socket-auth.test.js).
const initSocketAuth = (mediasoupEnabled) => {
  store.rooms = new AsyncNedb();
  store.peers = new AsyncNedb();
  store.onlineUsers = new Map();
  const removeSocket = (array, element) => {
    let result = [...array];
    let i = 0;
    let found = false;
    while (i < result.length && !found) {
      if (element.id === array[i].id) {
        result.splice(i, 1);
        found = true;
      }
      i++;
    }
    return result;
  };

  const onAuthenticated = (socket) => {
    const { email, id } = socket.decoded_token;
    logger.info({ socketId: socket.id, userId: id }, `Socket connected: ${email}`);

    if (mediasoupEnabled) {
      const mediasoup = require('./mediasoup');
      mediasoup.initSocket(socket);
    }

    socket.join(id);

    events.forEach((event) => socket.on(event.tag, (data) => event.callback(socket, data)));

    store.socketIds.push(socket.id);
    store.sockets[socket.id] = socket;

    if (!store.socketsByUserID[id]) store.socketsByUserID[id] = [];
    store.socketsByUserID[id].push(socket);
    store.userIDsBySocketID[socket.id] = id;

    store.onlineUsers.set(socket, { id, status: 'online' });
    store.io.emit('onlineUsers', Array.from(store.onlineUsers.values()));

    socket.emit('authenticated');

    socket.on('disconnect', () => {
      if (store.roomIDs[socket.id]) {
        let roomID = store.roomIDs[socket.id];
        store.consumerUserIDs[roomID].splice(store.consumerUserIDs[roomID].indexOf(socket.id), 1);
        socket.to(roomID).emit('consumers', { content: store.consumerUserIDs[roomID], timestamp: Date.now() });
        socket.to(roomID).emit('leave', { socketID: socket.id });
      }

      Meeting.update({}, { $pull: { peers: socket.id } }, { multi: true });

      store.peers.remove({ socketID: socket.id }, { multi: true });
      logger.info({ socketId: socket.id, userId: id }, `Socket disconnected: ${email}`);
      store.socketIds.splice(store.socketIds.indexOf(socket.id), 1);
      store.sockets[socket.id] = undefined;
      store.socketsByUserID[id] = removeSocket(store.socketsByUserID[id], socket);
      User.findOneAndUpdate({ _id: id }, { $set: { lastOnline: Date.now() } })
        .then(() => logger.debug({ userId: id }, 'Updated lastOnline'))
        .catch((err) => logger.error({ err, userId: id }, 'Failed to update lastOnline'));
      store.onlineUsers.delete(socket);
      store.io.emit('onlineUsers', Array.from(store.onlineUsers.values()));
    });
  };

  // socketio-jwt (built for Socket.IO v2's connection-middleware shape) doesn't work
  // with v4 — replaced with a plain post-connect 'authenticate' handshake using the
  // same jsonwebtoken already used for HTTP auth. Keeps socket.decoded_token intact
  // so every downstream consumer (mediasoup, events/*, routes) needs no changes.
  store.io.on('connection', (socket) => {
    const authTimeout = setTimeout(() => {
      socket.disconnect(true);
    }, 15000); // 15 seconds to send the authentication message

    socket.on('authenticate', async (data) => {
      clearTimeout(authTimeout);

      let decoded;
      try {
        decoded = jwt.verify((data && data.token) || '', store.config.secret);
      } catch (err) {
        socket.emit('unauthorized', { message: 'invalid_token' });
        socket.disconnect(true);
        return;
      }

      // Same legacy-token allowance as the HTTP strategy above — see comment there.
      if (decoded.deviceId) {
        const session = await Session.findById(decoded.deviceId).catch(() => null);
        if (!session || session.revokedAt) {
          socket.emit('unauthorized', { message: 'session_revoked' });
          socket.disconnect(true);
          return;
        }
      }

      socket.decoded_token = decoded;
      onAuthenticated(socket);
    });
  });
};

module.exports = (mediasoupEnabled) => {
  initSocketAuth(mediasoupEnabled);

  store.app.use(cors({ origin: store.config.corsOrigin }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
  });
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
  });
  // AI calls are slow and resource-intensive (even against a local model) — a much
  // tighter budget than general API traffic.
  const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'AI request limit reached, please try again later.' },
  });
  store.app.use(
    ['/api/login', '/api/register', '/api/auth/change', '/api/auth/code', '/api/auth/verify', '/api/check-user'],
    authLimiter,
  );
  store.app.use('/api/ai', aiLimiter);
  store.app.use('/api', apiLimiter);

  store.app.use(formidableMiddleware());
  store.app.use(passport.initialize());
  passport.use(
    'jwt',
    new Strategy(
      {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: store.config.secret,
      },
      async (payload, done) => {
        try {
          const user = await User.findById(payload.id);
          if (!user) return done(null, false);

          // Tokens issued before device-sessions existed have no deviceId — treat
          // as a legacy session (same trust level as today) rather than force-logout.
          if (payload.deviceId) {
            const session = await Session.findById(payload.deviceId);
            if (!session || session.revokedAt) return done(null, false);
            Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch((err) =>
              logger.warn({ err, sessionId: session._id }, 'Failed to update session lastSeenAt'));
          }

          return done(null, user);
        } catch (err) {
          logger.error({ err }, 'JWT strategy user lookup failed');
          return done(null, false);
        }
      },
    ),
  );
  store.app.use('/api', router);

  const mongooseConnect = () => {
    let connecting = setTimeout(() => logger.info('Connecting to DB...'), 1000);

    const { mongo } = store.config;
    const uri =
      mongo.uri ||
      `mongodb${mongo.srv ? '+srv' : ''}://${mongo.username}:${encodeURIComponent(mongo.password)}@${mongo.hostname}:${
        mongo.port
      }/${mongo.database}?authSource=${mongo.authenticationDatabase}`;

    mongoose.set('strictQuery', false);

    mongoose
      .connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        family: 4,
      })
      .then(() => {
        clearTimeout(connecting);
        const { username, email, password, firstName, lastName } = store.config.rootUser;
        User.findOne({ email }).then((user) => {
          if (!user)
            argon2
              .hash(password)
              .then((hash) => new User({ username, email, password: hash, firstName, lastName, level: 'root' }).save());
          else
            argon2
              .hash(password)
              .then((hash) =>
                User.findOneAndUpdate(
                  { email },
                  { $set: { username, email, password: hash, firstName, lastName, level: 'root' } },
                ),
              );
        });

        Meeting.updateMany({}, { $set: { peers: [] } }).catch((err) => logger.error({ err }, 'Failed to reset meeting peers on boot'));

        logger.info('Connected to DB');
        store.connected = true;
      })
      .catch((err) => {
        clearTimeout(connecting);
        logger.error({ err }, 'Unable to connect to DB — retrying in 10 seconds');
        setTimeout(mongooseConnect, 10 * 1000);
      });
  };
  mongooseConnect();
};

module.exports.initSocketAuth = initSocketAuth;
