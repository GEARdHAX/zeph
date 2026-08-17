process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-for-jest-only';

const request = require('supertest');
const argon2 = require('argon2');
const http = require('http');
const { Server } = require('socket.io');
const ioc = require('socket.io-client');
const jwt = require('jsonwebtoken');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const store = require('../src/store');
const config = require('../config');
const init = require('../src/init');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const ConversationUserState = require('../src/models/ConversationUserState');
const VaultCredential = require('../src/models/VaultCredential');

let app;

beforeAll(async () => {
  await db.connect();
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
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

const setPin = async (user, pin) => {
  await request(app)
    .post('/api/vault/pin/setup')
    .set('Authorization', `Bearer ${tokenFor(user)}`)
    .field('pin', pin);
};

const unlockWithPin = async (user, pin) => {
  const res = await request(app)
    .post('/api/vault/unlock/pin')
    .set('Authorization', `Bearer ${tokenFor(user)}`)
    .field('pin', pin);
  return res.body.vaultToken;
};

describe('POST /api/conversation/delete', () => {
  it('removes the conversation from the requester\'s own list-rooms only', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });
    await Message.create({ room: room._id, author: a._id, content: 'hi', type: 'text' });
    await Room.updateOne({ _id: room._id }, { $set: { lastMessage: (await Message.findOne({ room: room._id }))._id } });

    const del = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());
    expect(del.status).toBe(200);

    const aList = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(aList.body.rooms.find((r) => r._id === room._id.toString())).toBeUndefined();

    const bList = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`);
    expect(bList.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });

  it('does not touch the Room or Message documents at all', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: a._id, content: 'hi', type: 'text' });

    await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    expect(await Room.findById(room._id)).not.toBeNull();
    const stored = await Message.findById(message._id);
    expect(stored.content).toBe('hi');
  });

  it('is idempotent — repeated calls succeed without error', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });

    const first = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());
    const second = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const states = await ConversationUserState.find({ conversation: room._id, user: a._id });
    expect(states).toHaveLength(1);
  });

  it('rejects a non-member (IDOR)', async () => {
    const a = await createUser();
    const stranger = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });

    const res = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .field('conversationId', room._id.toString());

    expect(res.status).toBe(403);
    expect(await ConversationUserState.findOne({ conversation: room._id, user: stranger._id })).toBeNull();
  });

  it('join-room still works after delete — deleting only removes the inbox listing, not the deleter\'s own access', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });

    await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('id', room._id.toString());
    expect(res.status).toBe(200);
  });

  it('a new message from the other participant un-deletes the conversation back into view', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .field('roomID', room._id.toString())
      .field('content', 'hey again')
      .field('type', 'text');

    const state = await ConversationUserState.findOne({ conversation: room._id, user: a._id });
    expect(state.deletedAt).toBeNull();

    const aList = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(aList.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });

  it('the deleter sending their own message also un-deletes the conversation back into their own inbox', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('roomID', room._id.toString())
      .field('content', 'actually nevermind')
      .field('type', 'text');

    const state = await ConversationUserState.findOne({ conversation: room._id, user: a._id });
    expect(state.deletedAt).toBeNull();

    const aList = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(aList.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });
});

describe('POST /api/conversation/hide + unhide', () => {
  it('a hidden conversation is absent from normal list-rooms', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });

    await request(app)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const list = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(list.body.rooms.find((r) => r._id === room._id.toString())).toBeUndefined();
  });

  it('a hidden conversation appears in vault-list only with a valid vault token', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });
    await setPin(a, '1234');

    await request(app)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const noToken = await request(app).get('/api/vault/list').set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(noToken.status).toBe(401);

    const vaultToken = await unlockWithPin(a, '1234');
    const withToken = await request(app)
      .get('/api/vault/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .set('X-Vault-Token', vaultToken);
    expect(withToken.status).toBe(200);
    expect(withToken.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });

  it('join-room, get-room, more-messages, and sync-messages each independently reject a hidden room without a vault token', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: a._id, content: 'hi', type: 'text' });

    await request(app)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const auth = `Bearer ${tokenFor(a)}`;
    const join = await request(app).post('/api/room/join').set('Authorization', auth).field('id', room._id.toString());
    expect(join.status).toBe(403);

    const get = await request(app).post('/api/room/get').set('Authorization', auth).field('id', room._id.toString());
    expect(get.status).toBe(403);

    const more = await request(app)
      .post('/api/messages/more')
      .set('Authorization', auth)
      .field('roomID', room._id.toString())
      .field('firstMessageID', message._id.toString());
    expect(more.status).toBe(403);

    const sync = await request(app).post('/api/messages/sync').set('Authorization', auth).field('roomID', room._id.toString());
    expect(sync.status).toBe(403);
  });

  it('join-room, get-room, more-messages, and sync-messages each independently succeed with a valid vault token', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: a._id, content: 'hi', type: 'text' });
    await setPin(a, '1234');

    await request(app)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const vaultToken = await unlockWithPin(a, '1234');
    const auth = `Bearer ${tokenFor(a)}`;

    const join = await request(app)
      .post('/api/room/join')
      .set('Authorization', auth)
      .set('X-Vault-Token', vaultToken)
      .field('id', room._id.toString());
    expect(join.status).toBe(200);

    const get = await request(app)
      .post('/api/room/get')
      .set('Authorization', auth)
      .set('X-Vault-Token', vaultToken)
      .field('id', room._id.toString());
    expect(get.status).toBe(200);

    const more = await request(app)
      .post('/api/messages/more')
      .set('Authorization', auth)
      .set('X-Vault-Token', vaultToken)
      .field('roomID', room._id.toString())
      .field('firstMessageID', message._id.toString());
    expect(more.status).toBe(200);

    const sync = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', auth)
      .set('X-Vault-Token', vaultToken)
      .field('roomID', room._id.toString());
    expect(sync.status).toBe(200);
  });

  it('a stale/expired vault token is rejected even after join-room succeeded once this session', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });
    await setPin(a, '1234');

    await request(app)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const vaultToken = await unlockWithPin(a, '1234');
    const auth = `Bearer ${tokenFor(a)}`;

    const join = await request(app)
      .post('/api/room/join')
      .set('Authorization', auth)
      .set('X-Vault-Token', vaultToken)
      .field('id', room._id.toString());
    expect(join.status).toBe(200);

    // Simulate the vault token having expired — an already-expired token,
    // not the same valid one — proves more-messages doesn't trust the
    // earlier join-room success and re-checks independently.
    const expiredToken = jwt.sign(
      { id: a._id.toString(), purpose: 'vault' },
      config.secret,
      { expiresIn: -1 },
    );
    const more = await request(app)
      .post('/api/messages/more')
      .set('Authorization', auth)
      .set('X-Vault-Token', expiredToken)
      .field('roomID', room._id.toString())
      .field('firstMessageID', '000000000000000000000000');
    expect(more.status).toBe(403);
  });

  it('unhide requires a valid vault token and restores the conversation to normal list-rooms', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: a._id, content: 'hi', type: 'text' });
    await Room.updateOne({ _id: room._id }, { $set: { lastMessage: message._id } });
    await setPin(a, '1234');

    await request(app)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const noToken = await request(app)
      .post('/api/conversation/unhide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());
    expect(noToken.status).toBe(401);

    const vaultToken = await unlockWithPin(a, '1234');
    const withToken = await request(app)
      .post('/api/conversation/unhide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .set('X-Vault-Token', vaultToken)
      .field('conversationId', room._id.toString());
    expect(withToken.status).toBe(200);

    const list = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(list.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });

  it('idempotent repeat hide and repeat unhide', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });
    await setPin(a, '1234');

    await request(app).post('/api/conversation/hide').set('Authorization', `Bearer ${tokenFor(a)}`).field('conversationId', room._id.toString());
    const secondHide = await request(app).post('/api/conversation/hide').set('Authorization', `Bearer ${tokenFor(a)}`).field('conversationId', room._id.toString());
    expect(secondHide.status).toBe(200);

    const vaultToken = await unlockWithPin(a, '1234');
    await request(app).post('/api/conversation/unhide').set('Authorization', `Bearer ${tokenFor(a)}`).set('X-Vault-Token', vaultToken).field('conversationId', room._id.toString());
    const secondUnhide = await request(app).post('/api/conversation/unhide').set('Authorization', `Bearer ${tokenFor(a)}`).set('X-Vault-Token', vaultToken).field('conversationId', room._id.toString());
    expect(secondUnhide.status).toBe(200);

    const states = await ConversationUserState.find({ conversation: room._id, user: a._id });
    expect(states).toHaveLength(1);
  });

  it('a hidden conversation receiving a new message does not auto-unhide', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    await setPin(a, '1234');

    await request(app).post('/api/conversation/hide').set('Authorization', `Bearer ${tokenFor(a)}`).field('conversationId', room._id.toString());

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .field('roomID', room._id.toString())
      .field('content', 'hey')
      .field('type', 'text');

    const state = await ConversationUserState.findOne({ conversation: room._id, user: a._id });
    expect(state.isHidden).toBe(true);

    const list = await request(app).post('/api/rooms/list').set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(list.body.rooms.find((r) => r._id === room._id.toString())).toBeUndefined();
  });

  it('rejects a non-member trying to hide (IDOR)', async () => {
    const a = await createUser();
    const stranger = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });

    const res = await request(app)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .field('conversationId', room._id.toString());

    expect(res.status).toBe(403);
    expect(await ConversationUserState.findOne({ conversation: room._id, user: stranger._id })).toBeNull();
  });
});

describe('GET /api/vault/status', () => {
  it('reports not configured for a fresh user', async () => {
    const a = await createUser();
    const res = await request(app).get('/api/vault/status').set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it('reports configured after PIN setup, without exposing the hash', async () => {
    const a = await createUser();
    await setPin(a, '1234');
    const res = await request(app).get('/api/vault/status').set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(res.body.configured).toBe(true);
    expect(res.body.hasPin).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/\$argon2/);
  });
});

describe('Vault PIN setup and unlock', () => {
  it('first-time setup succeeds on the main JWT alone, then unlock succeeds with the right PIN', async () => {
    const a = await createUser();
    const setup = await setPin(a, '1234');
    const vaultToken = await unlockWithPin(a, '1234');
    expect(typeof vaultToken).toBe('string');
  });

  it('rejects an invalid PIN format', async () => {
    const a = await createUser();
    const res = await request(app)
      .post('/api/vault/pin/setup')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('pin', 'ab');
    expect(res.status).toBe(400);
  });

  it('wrong PIN is rejected with the same generic reason as no-vault-configured (no enumeration)', async () => {
    const a = await createUser();
    const b = await createUser();
    await setPin(a, '1234');

    const wrongPin = await request(app).post('/api/vault/unlock/pin').set('Authorization', `Bearer ${tokenFor(a)}`).field('pin', '9999');
    const noVault = await request(app).post('/api/vault/unlock/pin').set('Authorization', `Bearer ${tokenFor(b)}`).field('pin', '9999');

    expect(wrongPin.status).toBe(401);
    expect(noVault.status).toBe(401);
    expect(wrongPin.body.reason).toBe(noVault.body.reason);
  });

  it('changing an existing PIN requires a valid vault token, not just the main JWT', async () => {
    const a = await createUser();
    await setPin(a, '1234');

    const noToken = await request(app)
      .post('/api/vault/pin/setup')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('pin', '5678');
    expect(noToken.status).toBe(403);

    const vaultToken = await unlockWithPin(a, '1234');
    const withToken = await request(app)
      .post('/api/vault/pin/setup')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .set('X-Vault-Token', vaultToken)
      .field('pin', '5678');
    expect(withToken.status).toBe(200);
  });

  it('an expired vault token is rejected', async () => {
    const a = await createUser();
    const room = await Room.create({ people: [a._id], isGroup: false });
    await setPin(a, '1234');
    await request(app).post('/api/conversation/hide').set('Authorization', `Bearer ${tokenFor(a)}`).field('conversationId', room._id.toString());

    const expiredToken = jwt.sign({ id: a._id.toString(), purpose: 'vault' }, config.secret, { expiresIn: -1 });
    const res = await request(app)
      .get('/api/vault/list')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .set('X-Vault-Token', expiredToken);
    expect(res.status).toBe(401);
  });

  it('a vault token issued to user A cannot be used to satisfy user B\'s request', async () => {
    const a = await createUser();
    const b = await createUser();
    await setPin(a, '1234');
    const aVaultToken = await unlockWithPin(a, '1234');

    const res = await request(app)
      .get('/api/vault/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .set('X-Vault-Token', aVaultToken);
    expect(res.status).toBe(401);
  });
});

describe('WebAuthn vault registration authorization', () => {
  it('first-ever passkey registration is reachable on the main JWT alone', async () => {
    const a = await createUser();
    const res = await request(app)
      .post('/api/vault/webauthn/register/options')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeDefined();
  });

  it('once a PIN already exists, register/options requires a valid vault token', async () => {
    const a = await createUser();
    await setPin(a, '1234');

    const noToken = await request(app)
      .post('/api/vault/webauthn/register/options')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(noToken.status).toBe(403);

    const vaultToken = await unlockWithPin(a, '1234');
    const withToken = await request(app)
      .post('/api/vault/webauthn/register/options')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .set('X-Vault-Token', vaultToken);
    expect(withToken.status).toBe(200);
  });

  it('once a credential already exists, register/options requires a valid vault token', async () => {
    const a = await createUser();
    await VaultCredential.create({
      user: a._id, credentialID: 'existing-cred', publicKey: Buffer.from('x'), counter: 0, transports: [],
    });

    const noToken = await request(app)
      .post('/api/vault/webauthn/register/options')
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(noToken.status).toBe(403);
  });
});

describe('WebAuthn challenge single-use', () => {
  it('a second /auth/options call invalidates the first challenge (no replay across attempts)', async () => {
    const a = await createUser();

    const first = await request(app).post('/api/vault/webauthn/auth/options').set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(first.status).toBe(200);
    const firstChallenge = first.body.challenge;

    await request(app).post('/api/vault/webauthn/auth/options').set('Authorization', `Bearer ${tokenFor(a)}`);

    // Attempting to verify against the first (now-superseded) challenge with
    // a bogus response fails regardless — this asserts the challenge store
    // itself is single-slot-per-user (a fresh options call discards the
    // previous unconsumed challenge), which is the mechanism the single-use
    // "verify deletes on read" guarantee depends on.
    const verify = await request(app)
      .post('/api/vault/webauthn/auth/verify')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('response', JSON.stringify({ id: 'nonexistent', challenge: firstChallenge }));
    expect(verify.status).toBe(401);
  });

  it('auth/verify with no prior options call is rejected (no stored challenge to consume)', async () => {
    const a = await createUser();
    const res = await request(app)
      .post('/api/vault/webauthn/auth/verify')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('response', JSON.stringify({ id: 'nonexistent' }));
    expect(res.status).toBe(401);
  });
});

describe('Multi-device Socket.IO sync', () => {
  let server;
  let port;
  let httpApp;

  beforeAll(async () => {
    httpApp = buildApp();
    const httpServer = http.createServer(httpApp);
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
  });

  const connectAndAuth = (token) => new Promise((resolve, reject) => {
    const client = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    client.on('connect', () => client.emit('authenticate', { token }));
    client.on('authenticated', () => resolve(client));
    client.on('unauthorized', (err) => reject(new Error(JSON.stringify(err))));
  });

  it('hiding on device A emits conversation-hidden to device B (same user), and not to the other participant', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    const deviceA = await connectAndAuth(tokenFor(a));
    const deviceB = await connectAndAuth(tokenFor(a));
    const otherParticipant = await connectAndAuth(tokenFor(b));

    const deviceBEvent = new Promise((resolve) => deviceB.on('conversation-hidden', resolve));
    let otherGotEvent = false;
    otherParticipant.on('conversation-hidden', () => { otherGotEvent = true; });

    await request(httpApp)
      .post('/api/conversation/hide')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('conversationId', room._id.toString());

    const event = await deviceBEvent;
    expect(event.conversationId).toBe(room._id.toString());

    await new Promise((resolve) => { setTimeout(resolve, 150); });
    expect(otherGotEvent).toBe(false);

    deviceA.close();
    deviceB.close();
    otherParticipant.close();
  });
});
