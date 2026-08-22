const request = require('supertest');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const ioc = require('socket.io-client');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const config = require('../config');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const { isPrivileged, authorizeAction, Actions } = require('../src/authorization/policy');

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
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    level: overrides.level || 'standard',
    password,
  });
};

const createAdmin = (overrides = {}) => createUser({ ...overrides, level: 'root' });

// tokenFor() (helpers/app.js) signs {id, email} only — fine for HTTP routes
// since req.user there comes straight from the DB document (which has
// .level). Socket.IO tests need `level` IN the token itself, since
// socket.decoded_token is the raw JWT payload, not a fresh DB lookup —
// mirrors the real payload shape login.js signs.
const tokenWithLevel = (user) => jwt.sign(
  { id: user._id.toString(), email: user.email, level: user.level },
  config.secret,
  { expiresIn: '1h' },
);

describe('isPrivileged() unit behavior', () => {
  it('treats the default "standard" level as not privileged', () => {
    expect(isPrivileged({ level: 'standard' })).toBe(false);
  });
  it('treats "root" as privileged', () => {
    expect(isPrivileged({ level: 'root' })).toBe(true);
  });
  it('treats any future non-standard level (e.g. "admin") as privileged automatically', () => {
    expect(isPrivileged({ level: 'admin' })).toBe(true);
    expect(isPrivileged({ level: 'moderator' })).toBe(true);
  });
  it('treats a missing/undefined level as not privileged', () => {
    expect(isPrivileged({})).toBe(false);
    expect(isPrivileged(null)).toBe(false);
  });
});

describe('authorizeAction() admin_boundary check', () => {
  // Real ObjectIds required: authorizeAction() falls through to a
  // Relationship DB lookup once the boundary check itself allows, so a
  // non-ObjectId string throws a CastError in the ALLOW-path tests below.
  const mongoose = require('mongoose');
  const fakeActor = () => new mongoose.Types.ObjectId().toString();
  const fakeTarget = () => new mongoose.Types.ObjectId().toString();

  it('denies a standard actor targeting a privileged target, before relationship state matters', async () => {
    const result = await authorizeAction({
      actor: fakeActor(), target: fakeTarget(), action: Actions.SEND_MESSAGE, actorLevel: 'standard', targetLevel: 'root',
    });
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('admin_boundary');
  });
  it('allows a privileged actor targeting a privileged target', async () => {
    const result = await authorizeAction({
      actor: fakeActor(), target: fakeTarget(), action: Actions.SEND_MESSAGE, actorLevel: 'root', targetLevel: 'root',
    });
    expect(result.decision).toBe('ALLOW');
  });
  it('allows a privileged actor targeting a standard target (admin -> normal unaffected)', async () => {
    const result = await authorizeAction({
      actor: fakeActor(), target: fakeTarget(), action: Actions.SEND_MESSAGE, actorLevel: 'root', targetLevel: 'standard',
    });
    expect(result.decision).toBe('ALLOW');
  });
  it('skips the check entirely when levels are omitted (existing call sites unaffected)', async () => {
    const result = await authorizeAction({ actor: fakeActor(), target: fakeTarget(), action: Actions.SEND_MESSAGE });
    expect(result.decision).toBe('ALLOW');
  });
});

describe('Admin excluded from username search (POST /api/search)', () => {
  it('a standard caller never sees an admin in results', async () => {
    const me = await createUser();
    const admin = await createAdmin({ username: 'superadmin' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('search', 'superadmin');

    expect(res.status).toBe(200);
    expect(res.body.users.find((u) => u.username === 'superadmin')).toBeUndefined();
  });

  it('an admin caller DOES see other admins (and normal users) in results', async () => {
    const adminCaller = await createAdmin();
    const targetAdmin = await createAdmin({ username: 'superadmin' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(adminCaller)}`)
      .field('search', 'superadmin');

    expect(res.status).toBe(200);
    expect(res.body.users.find((u) => u.username === 'superadmin')).toBeDefined();
  });

  it('a standard user searching for another standard user is unaffected (regression check)', async () => {
    const me = await createUser();
    const other = await createUser({ username: 'findme' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('search', 'findme');

    expect(res.status).toBe(200);
    expect(res.body.users.find((u) => u.username === 'findme')).toBeDefined();
  });

  it('never leaks the `level` field itself to a standard caller', async () => {
    const me = await createUser();
    const other = await createUser({ username: 'plainuser' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('search', 'plainuser');

    const found = res.body.users.find((u) => u.username === 'plainuser');
    expect(found).toBeDefined();
    expect(found.level).toBeUndefined();
  });

  it('admin excluded from POST /api/user/list too', async () => {
    const me = await createUser();
    const admin = await createAdmin({ username: 'legacyadmin' });

    const res = await request(app)
      .post('/api/user/list')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('search', 'legacyadmin');

    expect(res.status).toBe(200);
    expect(res.body.find((u) => u.username === 'legacyadmin')).toBeUndefined();
  });
});

describe('Profile lookup denied (GET /api/users/:username)', () => {
  it('404s identically to "does not exist" for a standard caller looking up an admin', async () => {
    const me = await createUser();
    const admin = await createAdmin({ username: 'hiddenadmin' });

    const res = await request(app)
      .get('/api/users/hiddenadmin')
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    const notFoundRes = await request(app)
      .get('/api/users/doesnotexistatall')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(404);
    expect(notFoundRes.status).toBe(404);
    expect(res.body).toEqual(notFoundRes.body);
  });

  it('a standard user can still resolve another standard user (regression check)', async () => {
    const me = await createUser();
    const other = await createUser({ username: 'resolvable' });

    const res = await request(app)
      .get('/api/users/resolvable')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('resolvable');
  });

  it('an admin caller CAN resolve another admin', async () => {
    const adminCaller = await createAdmin();
    const targetAdmin = await createAdmin({ username: 'visibletoadmin' });

    const res = await request(app)
      .get('/api/users/visibletoadmin')
      .set('Authorization', `Bearer ${tokenFor(adminCaller)}`);

    expect(res.status).toBe(200);
  });
});

describe('Friend request denied (POST /api/friend-requests)', () => {
  it('404s at the lookup stage for a standard caller targeting an admin', async () => {
    const me = await createUser();
    const admin = await createAdmin({ username: 'friendtargetadmin' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'friendtargetadmin');

    expect(res.status).toBe(404);
  });

  it('a standard user can still friend-request another standard user (regression check)', async () => {
    const me = await createUser();
    const other = await createUser({ username: 'friendable' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'friendable');

    expect(res.status).toBe(200);
  });
});

describe('DM creation denied (POST /api/room/create)', () => {
  it('404s and creates no Room when a standard caller targets an admin', async () => {
    const me = await createUser();
    const admin = await createAdmin();

    const res = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', admin._id.toString());

    expect(res.status).toBe(404);
    const room = await Room.findOne({ people: { $all: [me._id, admin._id] } });
    expect(room).toBeNull();
  });

  it('a standard user can still create a DM with another standard user (regression check)', async () => {
    const me = await createUser();
    const other = await createUser();

    const res = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', other._id.toString());

    expect(res.status).toBe(200);
    const room = await Room.findOne({ people: { $all: [me._id, other._id] } });
    expect(room).not.toBeNull();
  });

  it('an admin caller CAN create a DM with another admin', async () => {
    const adminCaller = await createAdmin();
    const targetAdmin = await createAdmin();

    const res = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(adminCaller)}`)
      .field('counterpart', targetAdmin._id.toString());

    expect(res.status).toBe(200);
  });
});

describe('Existing admin DM denied post-hoc (join-room / get-room / more-messages / sync-messages / list-rooms)', () => {
  const seedAdminRoom = async () => {
    const me = await createUser();
    const admin = await createAdmin();
    const room = await Room.create({ people: [me._id, admin._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: admin._id, content: 'hi', type: 'text' });
    await Room.updateOne({ _id: room._id }, { $set: { lastMessage: message._id } });
    return {
      me, admin, room, message,
    };
  };

  it('join-room 404s for the standard user', async () => {
    const { me, room } = await seedAdminRoom();
    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('id', room._id.toString());
    expect(res.status).toBe(404);
  });

  it('get-room 404s for the standard user', async () => {
    const { me, room } = await seedAdminRoom();
    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('id', room._id.toString());
    expect(res.status).toBe(404);
  });

  it('more-messages 404s for the standard user', async () => {
    const { me, room, message } = await seedAdminRoom();
    const res = await request(app)
      .post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('roomID', room._id.toString())
      .field('firstMessageID', message._id.toString());
    expect(res.status).toBe(404);
  });

  it('sync-messages (reconnect resync) 404s for the standard user — explicitly required, not just initial join', async () => {
    const { me, room } = await seedAdminRoom();
    const res = await request(app)
      .post('/api/messages/sync')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('roomID', room._id.toString());
    expect(res.status).toBe(404);
  });

  it('list-rooms excludes the admin DM from the standard user\'s inbox', async () => {
    const { me, room } = await seedAdminRoom();
    const res = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    expect(res.status).toBe(200);
    expect(res.body.rooms.find((r) => r._id === room._id.toString())).toBeUndefined();
  });

  it('the admin\'s own access to the same room is completely unaffected', async () => {
    const { admin, room } = await seedAdminRoom();
    const joinRes = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .field('id', room._id.toString());
    expect(joinRes.status).toBe(200);

    const listRes = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(listRes.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });

  it('normal-user-to-normal-user DM is unaffected by all of the above (regression check)', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    const message = await Message.create({ room: room._id, author: b._id, content: 'hi', type: 'text' });
    await Room.updateOne({ _id: room._id }, { $set: { lastMessage: message._id } });

    const join = await request(app).post('/api/room/join').set('Authorization', `Bearer ${tokenFor(a)}`).field('id', room._id.toString());
    const get = await request(app).post('/api/room/get').set('Authorization', `Bearer ${tokenFor(a)}`).field('id', room._id.toString());
    const more = await request(app).post('/api/messages/more').set('Authorization', `Bearer ${tokenFor(a)}`).field('roomID', room._id.toString()).field('firstMessageID', message._id.toString());
    const sync = await request(app).post('/api/messages/sync').set('Authorization', `Bearer ${tokenFor(a)}`).field('roomID', room._id.toString());
    const list = await request(app).post('/api/rooms/list').set('Authorization', `Bearer ${tokenFor(a)}`);

    expect(join.status).toBe(200);
    expect(get.status).toBe(200);
    expect(more.status).toBe(200);
    expect(sync.status).toBe(200);
    expect(list.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });
});

describe('Direct-ID/username enumeration denied (manipulated/guessed IDs, not discovered via search)', () => {
  it('a manipulated admin _id sent directly to room/create gets the same 404 as a nonexistent id', async () => {
    const me = await createUser();
    const admin = await createAdmin();
    const fakeID = '507f1f77bcf86cd799439011';

    const adminRes = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', admin._id.toString());
    const fakeRes = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', fakeID);

    expect(adminRes.status).toBe(404);
    expect(fakeRes.status).toBe(404);
    expect(adminRes.body).toEqual(fakeRes.body);
  });

  it('a guessed admin room id sent directly to room/join gets the same 404 shape as a nonexistent room', async () => {
    const me = await createUser();
    const admin = await createAdmin();
    const room = await Room.create({ people: [me._id, admin._id], isGroup: false });
    const fakeRoomID = '507f1f77bcf86cd799439011';

    const realRes = await request(app).post('/api/room/join').set('Authorization', `Bearer ${tokenFor(me)}`).field('id', room._id.toString());
    const fakeRes = await request(app).post('/api/room/join').set('Authorization', `Bearer ${tokenFor(me)}`).field('id', fakeRoomID);

    expect(realRes.status).toBe(404);
    expect(fakeRes.status).toBe(404);
  });
});

describe('POST /api/check-user — pre-existing unauthenticated full-document leak, closed', () => {
  it('never returns the raw User document (password hash / email / vaultPinHash) for a valid token', async () => {
    const me = await createUser();
    const token = tokenFor(me);

    const res = await request(app).post('/api/check-user').field('token', token);

    expect(res.status).toBe(200);
    expect(res.body.password).toBeUndefined();
    expect(res.body.email).toBeUndefined();
    expect(res.body.vaultPinHash).toBeUndefined();
    expect(res.body.valid).toBe(true);
  });

  it('rejects a garbage/forged token instead of trusting a client-supplied id', async () => {
    const res = await request(app).post('/api/check-user').field('token', 'not-a-real-jwt');
    expect(res.body.error).toBe(true);
  });

  it('rejects a well-formed but unsigned/tampered token', async () => {
    const forged = jwt.sign({ id: '507f1f77bcf86cd799439011', email: 'x@example.com' }, 'wrong-secret');
    const res = await request(app).post('/api/check-user').field('token', forged);
    expect(res.body.error).toBe(true);
  });

  it('this route can be reached for any account, including admins — it is a token-validity check, not a discovery surface', async () => {
    const admin = await createAdmin();
    const res = await request(app).post('/api/check-user').field('token', tokenFor(admin));
    // Correct behavior here is "valid: true" with no document — checking
    // whether YOUR OWN token is still good is not the same as another user
    // discovering an admin exists, so this is intentionally not gated by
    // the admin-privacy-boundary (there is no actor/target pair here).
    expect(res.body.valid).toBe(true);
    expect(res.body.password).toBeUndefined();
  });
});

describe('Group create/invite (POST /api/group/create) — locked scope: exempt from the boundary', () => {
  it('a group can legitimately include a privileged member (admins are not excluded from groups)', async () => {
    const me = await createUser();
    const admin = await createAdmin();

    // Real frontend usage (createGroup.js) sends a plain JSON body via
    // axios, not multipart form fields — .send() matches that, unlike
    // .field() which is for multipart encoding.
    const res = await request(app)
      .post('/api/group/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .send({ title: 'Team Chat', people: [me._id.toString(), admin._id.toString()] });

    expect(res.status).toBe(200);
  });

  it('rejects a group referencing a nonexistent member id (pre-existing gap closed in passing)', async () => {
    const me = await createUser();
    const fakeID = '507f1f77bcf86cd799439011';

    const res = await request(app)
      .post('/api/group/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .send({ title: 'Broken Group', people: [me._id.toString(), fakeID] });

    expect(res.status).toBe(400);
  });
});

describe('Admin excluded from group member discovery — 1:1-only scope, group access itself is exempt', () => {
  it('a standard co-member does NOT lose access to a group that legitimately contains an admin', async () => {
    const admin = await createAdmin();
    const standard = await createUser();
    const room = await Room.create({ people: [admin._id, standard._id], isGroup: true, title: 'Shared Group' });

    const getRes = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(standard)}`)
      .field('id', room._id.toString());
    expect(getRes.status).toBe(200);

    const listRes = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(standard)}`);
    expect(listRes.body.rooms.find((r) => r._id === room._id.toString())).toBeDefined();
  });

  it('that same admin still never surfaces via search/profile-lookup/friend-request/new-DM for the standard co-member', async () => {
    const admin = await createAdmin({ username: 'groupmateadmin' });
    const standard = await createUser();
    await Room.create({ people: [admin._id, standard._id], isGroup: true, title: 'Shared Group' });

    const searchRes = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(standard)}`)
      .field('search', 'groupmateadmin');
    expect(searchRes.body.users.find((u) => u.username === 'groupmateadmin')).toBeUndefined();

    const resolveRes = await request(app)
      .get('/api/users/groupmateadmin')
      .set('Authorization', `Bearer ${tokenFor(standard)}`);
    expect(resolveRes.status).toBe(404);

    const dmRes = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(standard)}`)
      .field('counterpart', admin._id.toString());
    expect(dmRes.status).toBe(404);
  });
});

describe('Calls denied (meeting/add, meeting/answer)', () => {
  it('meeting/add silently no-ops (still 200, no socket emit) when targeting an admin from a standard caller', async () => {
    const me = await createUser();
    const admin = await createAdmin();
    const store = require('../src/store');
    const emitSpy = jest.fn();
    const toSpy = jest.spyOn(store.io, 'to').mockReturnValue({ emit: emitSpy });

    const res = await request(app)
      .post('/api/meeting/add')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('userID', admin._id.toString())
      .field('meetingID', 'meeting-1');

    // Fire-and-forget shape: still 200 (anti-enumeration — no distinguishable
    // failure to the caller), but the 'call' event must never actually reach
    // the admin's socket.
    expect(res.status).toBe(200);
    expect(emitSpy).not.toHaveBeenCalled();

    toSpy.mockRestore();
  });

  it('meeting/add DOES emit when targeting a normal user (regression check)', async () => {
    const me = await createUser();
    const other = await createUser();
    const store = require('../src/store');
    const emitSpy = jest.fn();
    const toSpy = jest.spyOn(store.io, 'to').mockReturnValue({ emit: emitSpy });

    const res = await request(app)
      .post('/api/meeting/add')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('userID', other._id.toString())
      .field('meetingID', 'meeting-1');

    expect(res.status).toBe(200);
    expect(emitSpy).toHaveBeenCalled();

    toSpy.mockRestore();
  });

  it('meeting/call 404s for a standard caller in a room with an admin', async () => {
    const me = await createUser();
    const admin = await createAdmin();
    const room = await Room.create({ people: [me._id, admin._id], isGroup: false });

    const res = await request(app)
      .post('/api/meeting/call')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('roomID', room._id.toString())
      .field('meetingID', 'meeting-2');

    expect(res.status).toBe(404);
  });

  it('meeting/call still works for a normal 1:1 room (regression check)', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    const res = await request(app)
      .post('/api/meeting/call')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('roomID', room._id.toString())
      .field('meetingID', 'meeting-3');

    expect(res.status).toBe(200);
  });
});

describe('Favorites — gated by the same room-visibility rules', () => {
  it('a favorited room that later becomes a boundary violation drops out of list-favorites', async () => {
    const me = await createUser();
    const admin = await createAdmin();
    const room = await Room.create({ people: [me._id, admin._id], isGroup: false });
    await User.updateOne({ _id: me._id }, { $push: { favorites: room._id } });

    const res = await request(app)
      .post('/api/favorites/list')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(res.body.favorites.find((r) => r._id.toString() === room._id.toString())).toBeUndefined();
  });

  it('a favorited normal-user room is unaffected (regression check)', async () => {
    const me = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [me._id, other._id], isGroup: false });
    await User.updateOne({ _id: me._id }, { $push: { favorites: room._id } });

    const res = await request(app)
      .post('/api/favorites/list')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.body.favorites.find((r) => r._id.toString() === room._id.toString())).toBeDefined();
  });
});

describe('Presence denied — Socket.IO onlineUsers broadcast', () => {
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

  // Attaches the onlineUsers listener BEFORE emitting 'authenticate' — the
  // server broadcasts presence as part of the authenticate handler itself,
  // BEFORE it sends the 'authenticated' ack (see init.js: broadcastPresence()
  // runs, then socket.emit('authenticated')). Waiting for 'authenticated'
  // first and only then attaching an onlineUsers listener misses that very
  // connection's own broadcast — socket.io does not replay/buffer past
  // events for a listener attached late. Collecting every event from
  // connection time onward sidesteps the ordering entirely.
  const connectAndAuth = (token) => new Promise((resolve, reject) => {
    const client = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    const presenceEvents = [];
    client.on('onlineUsers', (view) => presenceEvents.push(view));
    client.on('connect', () => client.emit('authenticate', { token }));
    client.on('authenticated', () => resolve({ client, presenceEvents }));
    client.on('unauthorized', (err) => reject(new Error(JSON.stringify(err))));
  });

  // Waits until presenceEvents has at least `count` entries (a new
  // connection elsewhere triggers one more broadcast to every socket).
  const waitForPresenceCount = (presenceEvents, count) => new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (presenceEvents.length >= count) return resolve(presenceEvents[presenceEvents.length - 1]);
      if (Date.now() - start > 5000) return reject(new Error('Timed out waiting for onlineUsers broadcast'));
      setTimeout(check, 50);
    };
    check();
  });

  it("a standard user's onlineUsers view never contains a privileged user's id", async () => {
    const standard = await createUser();
    const admin = await createAdmin();

    const { client: standardClient, presenceEvents } = await connectAndAuth(tokenWithLevel(standard));
    await connectAndAuth(tokenWithLevel(admin));
    const latestView = await waitForPresenceCount(presenceEvents, 2);

    expect(latestView.map((e) => e.id)).not.toContain(admin._id.toString());
    standardClient.close();
  }, 15000);

  it("an admin's onlineUsers view DOES contain other privileged users", async () => {
    const adminCaller = await createAdmin();
    const otherAdmin = await createAdmin();

    const { client: adminClient, presenceEvents } = await connectAndAuth(tokenWithLevel(adminCaller));
    await connectAndAuth(tokenWithLevel(otherAdmin));
    const latestView = await waitForPresenceCount(presenceEvents, 2);

    expect(latestView.map((e) => e.id)).toContain(otherAdmin._id.toString());
    adminClient.close();
  }, 15000);

  it('a standard user still sees other standard users online (regression check)', async () => {
    const standard = await createUser();
    const otherStandard = await createUser();

    const { client: standardClient, presenceEvents } = await connectAndAuth(tokenWithLevel(standard));
    await connectAndAuth(tokenWithLevel(otherStandard));
    const latestView = await waitForPresenceCount(presenceEvents, 2);

    expect(latestView.map((e) => e.id)).toContain(otherStandard._id.toString());
    standardClient.close();
  }, 15000);

  it('the presence payload never includes the `level` field itself', async () => {
    const adminCaller = await createAdmin();
    const otherAdmin = await createAdmin();

    const { client: adminClient, presenceEvents } = await connectAndAuth(tokenWithLevel(adminCaller));
    await connectAndAuth(tokenWithLevel(otherAdmin));
    const latestView = await waitForPresenceCount(presenceEvents, 2);

    latestView.forEach((entry) => expect(entry.level).toBeUndefined());
    adminClient.close();
  }, 15000);
});
