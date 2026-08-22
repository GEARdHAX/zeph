const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const ioc = require('socket.io-client');
const db = require('./helpers/db');
const config = require('../config');
const User = require('../src/models/User');
const Relationship = require('../src/models/Relationship');

let app;

beforeAll(async () => {
  await db.connect();
  const { buildApp } = require('./helpers/app');
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const createUser = async (overrides = {}) => {
  const password = await argon2.hash('password123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    level: 'standard',
    password,
  });
};

// Socket.IO tests need `level` in the token itself, since socket.decoded_token
// is the raw JWT payload, not a fresh DB lookup — mirrors login.js's payload
// shape (see admin-boundary.test.js's identical helper).
const tokenWithLevel = (user) => jwt.sign(
  { id: user._id.toString(), email: user.email, level: user.level },
  config.secret,
  { expiresIn: '1h' },
);

describe('Presence hides blocked relationships — Socket.IO onlineUsers broadcast', () => {
  let server;
  let port;
  let store;

  beforeAll(async () => {
    const httpServer = http.createServer();
    store = require('../src/store');
    store.io = new Server(httpServer);
    store.config = config;
    const init = require('../src/init');
    init.initSocketAuth(false);
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
  });

  // Same ordering rationale as admin-boundary.test.js: the server broadcasts
  // presence inside the authenticate handler itself, before the
  // 'authenticated' ack — attach the listener from connection time onward.
  const connectAndAuth = (token) => new Promise((resolve, reject) => {
    const client = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    const presenceEvents = [];
    client.on('onlineUsers', (view) => presenceEvents.push(view));
    client.on('connect', () => client.emit('authenticate', { token }));
    client.on('authenticated', () => resolve({ client, presenceEvents }));
    client.on('unauthorized', (err) => reject(new Error(JSON.stringify(err))));
  });

  const waitForPresenceCount = (presenceEvents, count) => new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (presenceEvents.length >= count) return resolve(presenceEvents[presenceEvents.length - 1]);
      if (Date.now() - start > 5000) return reject(new Error('Timed out waiting for onlineUsers broadcast'));
      setTimeout(check, 50);
    };
    check();
  });

  it('a blocker never sees the blocked user in their onlineUsers view', async () => {
    const blocker = await createUser();
    const blocked = await createUser();
    await Relationship.create({
      requester: blocker._id, recipient: blocked._id, status: 'blocked', blockedBy: blocker._id,
    });

    const { client: blockerClient, presenceEvents } = await connectAndAuth(tokenWithLevel(blocker));
    await connectAndAuth(tokenWithLevel(blocked));
    const latestView = await waitForPresenceCount(presenceEvents, 2);

    expect(latestView.map((e) => e.id)).not.toContain(blocked._id.toString());
    blockerClient.close();
  }, 15000);

  it('the blocked user also never sees the blocker — hidden in both directions', async () => {
    const blocker = await createUser();
    const blocked = await createUser();
    await Relationship.create({
      requester: blocker._id, recipient: blocked._id, status: 'blocked', blockedBy: blocker._id,
    });

    const { client: blockedClient, presenceEvents } = await connectAndAuth(tokenWithLevel(blocked));
    await connectAndAuth(tokenWithLevel(blocker));
    const latestView = await waitForPresenceCount(presenceEvents, 2);

    expect(latestView.map((e) => e.id)).not.toContain(blocker._id.toString());
    blockedClient.close();
  }, 15000);

  it('a blocked relationship does not hide presence from unrelated third parties', async () => {
    const blocker = await createUser();
    const blocked = await createUser();
    const bystander = await createUser();
    await Relationship.create({
      requester: blocker._id, recipient: blocked._id, status: 'blocked', blockedBy: blocker._id,
    });

    const { client: bystanderClient, presenceEvents } = await connectAndAuth(tokenWithLevel(bystander));
    await connectAndAuth(tokenWithLevel(blocker));
    await connectAndAuth(tokenWithLevel(blocked));
    const latestView = await waitForPresenceCount(presenceEvents, 3);

    expect(latestView.map((e) => e.id)).toContain(blocker._id.toString());
    expect(latestView.map((e) => e.id)).toContain(blocked._id.toString());
    bystanderClient.close();
  }, 15000);

  it('a non-blocked relationship (pending/accepted) is unaffected — regression check', async () => {
    const a = await createUser();
    const b = await createUser();
    await Relationship.create({ requester: a._id, recipient: b._id, status: 'accepted' });

    const { client: aClient, presenceEvents } = await connectAndAuth(tokenWithLevel(a));
    await connectAndAuth(tokenWithLevel(b));
    const latestView = await waitForPresenceCount(presenceEvents, 2);

    expect(latestView.map((e) => e.id)).toContain(b._id.toString());
    aClient.close();
  }, 15000);
});
