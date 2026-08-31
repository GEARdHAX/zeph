process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-for-jest-only';

const http = require('http');
const { Server } = require('socket.io');
const ioc = require('socket.io-client');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const store = require('../src/store');
const config = require('../config');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const init = require('../src/init');

// A freshly-minted ObjectId is always "later" than anything seeded before
// it (Mongo ObjectIds are time-ordered) — used as the pagination cursor so
// $lt actually includes the seeded message. (messageID: null doesn't work
// here — BSON sorts null before every ObjectId, so $lt: null matches
// nothing at all.)
const futureCursor = () => new mongoose.Types.ObjectId().toString();

let server;
let port;

beforeAll(async () => {
  await db.connect();
  store.config = config;
  const httpServer = http.createServer();
  store.io = new Server(httpServer);
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
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

const createUser = async (overrides = {}) => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    level: overrides.level || 'standard',
    password,
  });
};

const tokenFor = (user) => jwt.sign(
  { id: user._id.toString(), email: user.email, level: user.level },
  config.secret,
  { expiresIn: '1h' },
);

const connectAndAuth = (user) => new Promise((resolve) => {
  const client = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  client.on('connect', () => client.emit('authenticate', { token: tokenFor(user) }));
  client.on('authenticated', () => resolve(client));
});

// Phase 7 audit finding: both events/more-messages.js and
// events/more-images.js previously trusted a client-supplied roomID with
// NO membership check at all — any authenticated socket could page
// through any room's history by guessing/enumerating a Mongo ObjectId.
describe('more-messages socket event — authorization', () => {
  it('a room member gets 200 and their messages', async () => {
    const member = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [member._id, other._id], title: 'Room', isGroup: true });
    const message = await Message.create({ author: other._id, room: room._id, content: 'hi', type: 'text' });

    const client = await connectAndAuth(member);
    const response = new Promise((resolve) => client.on('more-messages', resolve));
    client.emit('more-messages', { roomID: room._id.toString(), messageID: futureCursor() });

    const data = await response;
    expect(data.status).toBe(200);
    expect(data.messages.map((m) => m._id)).toContain(message._id.toString());
    client.close();
  });

  it('a non-member gets 403, not the room\'s messages', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [member._id], title: 'Room', isGroup: true });
    await Message.create({ author: member._id, room: room._id, content: 'secret', type: 'text' });

    const client = await connectAndAuth(outsider);
    const response = new Promise((resolve) => client.on('more-messages', resolve));
    client.emit('more-messages', { roomID: room._id.toString(), messageID: futureCursor() });

    const data = await response;
    expect(data.status).toBe(403);
    expect(data.messages).toEqual([]);
    client.close();
  });

  it('a non-existent roomID gets 404, not a crash', async () => {
    const user = await createUser();
    const client = await connectAndAuth(user);
    const response = new Promise((resolve) => client.on('more-messages', resolve));
    client.emit('more-messages', { roomID: '507f1f77bcf86cd799439011', messageID: futureCursor() });

    const data = await response;
    expect(data.status).toBe(404);
    client.close();
  });
});

describe('more-images socket event — authorization', () => {
  it('a room member gets 200 and their images', async () => {
    const member = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [member._id, other._id], title: 'Room', isGroup: true });
    const image = await Message.create({ author: other._id, room: room._id, content: 'pic', type: 'image' });

    const client = await connectAndAuth(member);
    const response = new Promise((resolve) => client.on('more-images', resolve));
    client.emit('more-images', { roomID: room._id.toString(), messageID: futureCursor() });

    const data = await response;
    expect(data.status).toBe(200);
    expect(data.images.map((m) => m._id)).toContain(image._id.toString());
    client.close();
  });

  it('a non-member gets 403, not the room\'s images', async () => {
    const member = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [member._id], title: 'Room', isGroup: true });
    await Message.create({ author: member._id, room: room._id, content: 'secret pic', type: 'image' });

    const client = await connectAndAuth(outsider);
    const response = new Promise((resolve) => client.on('more-images', resolve));
    client.emit('more-images', { roomID: room._id.toString(), messageID: futureCursor() });

    const data = await response;
    expect(data.status).toBe(403);
    expect(data.images).toEqual([]);
    client.close();
  });

  it('a non-existent roomID gets 404, not a crash', async () => {
    const user = await createUser();
    const client = await connectAndAuth(user);
    const response = new Promise((resolve) => client.on('more-images', resolve));
    client.emit('more-images', { roomID: '507f1f77bcf86cd799439011', messageID: futureCursor() });

    const data = await response;
    expect(data.status).toBe(404);
    client.close();
  });
});
