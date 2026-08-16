process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-for-jest-only';

const http = require('http');
const { Server } = require('socket.io');
const ioc = require('socket.io-client');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const db = require('./helpers/db');
const store = require('../src/store');
const config = require('../config');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const init = require('../src/init');

let server;
let port;

beforeAll(async () => {
  await db.connect();

  store.config = config;
  const httpServer = http.createServer();
  store.io = new Server(httpServer);
  init.initSocketAuth(false); // mediasoupEnabled=false; wires only the socket layer, no Mongo/HTTP setup

  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      resolve();
    });
  });
  server = httpServer;
});

afterAll(async () => {
  store.io.close();
  await new Promise((resolve) => server.close(resolve));
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const createUser = async () => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

const connectClient = () => ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });

describe('Socket.IO v4 handshake regression (replaces socketio-jwt)', () => {
  it('authenticates with a valid JWT and receives the "authenticated" ack', (done) => {
    createUser().then((user) => {
      const token = jwt.sign({ id: user._id.toString(), email: user.email }, config.secret, { expiresIn: '1h' });
      const client = connectClient();

      client.on('connect', () => client.emit('authenticate', { token }));
      client.on('authenticated', () => {
        client.close();
        done();
      });
      client.on('unauthorized', (err) => {
        client.close();
        done(new Error(`unexpected unauthorized: ${JSON.stringify(err)}`));
      });
    });
  });

  it('rejects an invalid token and disconnects the socket', (done) => {
    const client = connectClient();

    client.on('connect', () => client.emit('authenticate', { token: 'not-a-real-token' }));
    client.on('unauthorized', (err) => {
      expect(err.message).toBe('invalid_token');
    });
    client.on('disconnect', () => {
      client.close();
      done();
    });
  });

  it("delivers a targeted emit to the authenticated user's personal room (socket.decoded_token.id join)", (done) => {
    createUser().then((user) => {
      const token = jwt.sign({ id: user._id.toString(), email: user.email }, config.secret, { expiresIn: '1h' });
      const client = connectClient();

      client.on('connect', () => client.emit('authenticate', { token }));
      client.on('authenticated', () => {
        store.io.to(user._id.toString()).emit('ping-test', { ok: true });
      });
      client.on('ping-test', (data) => {
        expect(data.ok).toBe(true);
        client.close();
        done();
      });
    });
  });
});

describe('Device sessions on the socket auth path', () => {
  it('rejects a token whose backing session has been revoked', (done) => {
    createUser().then(async (user) => {
      const session = await Session.create({ user: user._id, userAgent: 'jest' });
      await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });

      const token = jwt.sign(
        { id: user._id.toString(), email: user.email, deviceId: session._id.toString() },
        config.secret,
        { expiresIn: '1h' },
      );
      const client = connectClient();

      client.on('connect', () => client.emit('authenticate', { token }));
      client.on('unauthorized', (err) => {
        expect(err.message).toBe('session_revoked');
      });
      client.on('disconnect', () => {
        client.close();
        done();
      });
      client.on('authenticated', () => {
        client.close();
        done(new Error('expected the revoked session to be rejected'));
      });
    });
  });

  it('accepts a token whose session is active', (done) => {
    createUser().then(async (user) => {
      const session = await Session.create({ user: user._id, userAgent: 'jest' });
      const token = jwt.sign(
        { id: user._id.toString(), email: user.email, deviceId: session._id.toString() },
        config.secret,
        { expiresIn: '1h' },
      );
      const client = connectClient();

      client.on('connect', () => client.emit('authenticate', { token }));
      client.on('authenticated', () => {
        client.close();
        done();
      });
      client.on('unauthorized', (err) => {
        client.close();
        done(new Error(`unexpected unauthorized: ${JSON.stringify(err)}`));
      });
    });
  });
});
