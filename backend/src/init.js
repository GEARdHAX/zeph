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
const Room = require('./models/Room');
const GroupMember = require('./models/GroupMember');
const { broadcastPresence } = require('./presence');

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

    store.onlineUsers.set(socket, { id, status: 'online', level: socket.decoded_token.level });
    broadcastPresence().catch((err) => logger.error({ err }, 'Failed to broadcast presence'));

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
      broadcastPresence().catch((err) => logger.error({ err }, 'Failed to broadcast presence'));
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

  // Mounted before CORS/rate-limiting/body-parsing so a monitor/load-balancer
  // probe is never blocked by any of that, and before Mongo connects so it
  // can correctly report 503 during the connecting-at-boot window instead of
  // erroring. docker-compose.yml's healthcheck already curls
  // http://localhost:PORT/healthz (no /api prefix) — this route was written
  // for exactly that but was never actually mounted anywhere, so the
  // healthcheck has been silently unreachable (curl connection error, not a
  // real health signal) since it was added. See routes/health.js.
  store.app.get('/healthz', require('./routes/health'));

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
  // Username search/profile-resolution/friend-requests/new-conversation-with-a-
  // stranger are the enumeration + unsolicited-contact abuse surface (username
  // brute-forcing, mass friend-request spam, spamming DMs at strangers) —
  // tighter than general API traffic, looser than auth since search is used
  // interactively while typing.
  const discoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
  });
  // Deletion is a mutation on data that already exists (not spam-creation),
  // so this is deliberately looser than discoveryLimiter — but still bounded
  // against a buggy client or script hammering delete on every message in a
  // long thread.
  const deleteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
  });
  // PIN brute-force is the real risk on vault unlock — a 4-12 digit PIN has
  // far less entropy than a password, so this is materially tighter than
  // authLimiter's 20/15min despite being conceptually similar ("prove who
  // you are"). Covers both unlock paths (PIN verify, passkey assertion
  // verify) — either one is the attacker's target, not just one of them.
  const vaultUnlockLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many vault unlock attempts, please try again later.' },
  });
  store.app.use(
    ['/api/login', '/api/register', '/api/auth/change', '/api/auth/code', '/api/auth/verify', '/api/check-user'],
    authLimiter,
  );
  store.app.use('/api/ai', aiLimiter);
  store.app.use(
    [
      '/api/search', '/api/users', '/api/friend-requests', '/api/friends', '/api/room/create', '/api/block',
      '/api/unblock', '/api/group/create', '/api/group/members/search', '/api/group/members/add',
    ],
    discoveryLimiter,
  );
  store.app.use(
    [
      '/api/message/delete', '/api/conversation/hide', '/api/conversation/unhide', '/api/conversation/delete',
      '/api/group/members/remove', '/api/group/leave', '/api/group/delete', '/api/meeting/delete',
      '/api/users/delete-account',
    ],
    deleteLimiter,
  );
  store.app.use(['/api/vault/unlock/pin', '/api/vault/webauthn/auth/verify'], vaultUnlockLimiter);
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
        // Matched by username OR email — a mismatch between the two (e.g. the
        // ROOT_USER_EMAIL env var changed after the account was first seeded)
        // must never be treated as "no root user exists yet": that path tries
        // to INSERT a new user with the same unique `username`, which throws
        // an uncaught E11000 duplicate-key error and crashes the whole
        // process on boot — this is exactly what happened on Render, in a
        // crash loop, because .save() had no .catch(). Provisioning the root
        // user is a best-effort boot step, never allowed to take the server
        // down.
        User.findOne({ $or: [{ username }, { email }] })
          .then((user) => {
            if (!user) {
              return argon2
                .hash(password)
                .then((hash) => new User({
                  username, email, password: hash, firstName, lastName, level: 'root',
                }).save());
            }
            return argon2
              .hash(password)
              .then((hash) => User.findOneAndUpdate(
                { _id: user._id },
                {
                  $set: {
                    username,
                    usernameNormalized: username.toLowerCase(),
                    email,
                    password: hash,
                    firstName,
                    lastName,
                    level: 'root',
                  },
                },
              ));
          })
          .catch((err) => logger.error({ err }, 'Failed to provision root user on boot'));

        Meeting.updateMany({}, { $set: { peers: [] } }).catch((err) => logger.error({ err }, 'Failed to reset meeting peers on boot'));

        // Backfill usernameNormalized for users created before it existed (findOneAndUpdate/
        // legacy documents bypass the pre-save hook that keeps it in sync). Idempotent —
        // no-ops once every user has it, safe to run on every boot instead of a one-off script.
        User.find({ username: { $exists: true, $ne: null }, usernameNormalized: { $exists: false } })
          .then((users) =>
            Promise.all(
              users.map((u) => User.updateOne({ _id: u._id }, { $set: { usernameNormalized: u.username.toLowerCase() } })),
            ))
          .then((results) => {
            if (results.length) logger.info({ count: results.length }, 'Backfilled usernameNormalized for legacy users');
          })
          .catch((err) => logger.error({ err }, 'Failed to backfill usernameNormalized'));

        // Backfill GroupMember(OWNER/MEMBER) for isGroup:true rooms created
        // before the Groups feature existed (zero GroupMember rows). people[0]
        // is treated as owner — the only ordering signal that existed before
        // roles did. Idempotent — only touches rooms with zero existing
        // GroupMember rows, safe on every boot. See DECISIONS.md D-035.
        Room.find({ isGroup: true })
          .then(async (groups) => {
            let backfilled = 0;
            for (const room of groups) {
              const hasMembers = await GroupMember.exists({ group: room._id });
              if (hasMembers) continue;
              const [ownerId, ...rest] = room.people;
              if (!ownerId) continue;
              await GroupMember.create({ group: room._id, user: ownerId, role: 'OWNER' });
              if (rest.length) {
                await GroupMember.insertMany(rest.map((u) => ({ group: room._id, user: u, role: 'MEMBER' })));
              }
              await Room.updateOne({ _id: room._id }, { $set: { ownerId, privacy: room.privacy || 'PRIVATE' } });
              backfilled += 1;
            }
            if (backfilled) logger.info({ count: backfilled }, 'Backfilled GroupMember rows for legacy groups');
          })
          .catch((err) => logger.error({ err }, 'Failed to backfill GroupMember for legacy groups'));

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
