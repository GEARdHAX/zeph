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
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const init = require('../src/init');

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

const createUser = async () => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    level: 'standard',
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

describe('message-delivered socket event', () => {
  it('records delivery and relays it to the other room member, not the acker', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], title: 'Room', isGroup: true });
    const message = await Message.create({ author: sender._id, room: room._id, content: 'hi', type: 'text' });

    const senderClient = await connectAndAuth(sender);
    const recipientClient = await connectAndAuth(recipient);

    const senderGotEvent = new Promise((resolve) => {
      senderClient.on('message-delivered', (data) => resolve(data));
    });
    const recipientGotEvent = new Promise((resolve, reject) => {
      recipientClient.on('message-delivered', () => reject(new Error('acker should not receive its own delivery event')));
      setTimeout(resolve, 300);
    });

    recipientClient.emit('message-delivered', { roomID: room._id.toString(), messageID: message._id.toString() });

    const data = await senderGotEvent;
    await recipientGotEvent;

    expect(data.messageID).toBe(message._id.toString());
    expect(data.readerID).toBe(recipient._id.toString());

    const updated = await Message.findById(message._id);
    expect(updated.deliveredTo.map((id) => id.toString())).toContain(recipient._id.toString());

    senderClient.close();
    recipientClient.close();
  });

  it('is idempotent — acking delivery twice does not duplicate the deliveredTo entry', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], title: 'Room', isGroup: true });
    const message = await Message.create({ author: sender._id, room: room._id, content: 'hi', type: 'text' });

    const recipientClient = await connectAndAuth(recipient);

    recipientClient.emit('message-delivered', { roomID: room._id.toString(), messageID: message._id.toString() });
    await new Promise((resolve) => setTimeout(resolve, 150));
    recipientClient.emit('message-delivered', { roomID: room._id.toString(), messageID: message._id.toString() });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const updated = await Message.findById(message._id);
    expect(updated.deliveredTo.length).toBe(1);

    recipientClient.close();
  });

  it('silently ignores a delivery ack from a non-member of the room', async () => {
    const sender = await createUser();
    const recipient = await createUser();
    const outsider = await createUser();
    const room = await Room.create({ people: [sender._id, recipient._id], title: 'Room', isGroup: true });
    const message = await Message.create({ author: sender._id, room: room._id, content: 'hi', type: 'text' });

    const outsiderClient = await connectAndAuth(outsider);
    outsiderClient.emit('message-delivered', { roomID: room._id.toString(), messageID: message._id.toString() });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const updated = await Message.findById(message._id);
    expect(updated.deliveredTo.length).toBe(0);

    outsiderClient.close();
  });
});
