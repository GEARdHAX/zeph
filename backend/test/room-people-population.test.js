const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Relationship = require('../src/models/Relationship');

const setUpVaultPin = async (user) => {
  user.vaultPinHash = await argon2.hash('1234');
  await user.save();
};

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
    level: 'standard',
    password,
  });
};

// Regression coverage for a real bug: room.people = room.people.map(...)
// reassigning a plain-object array back onto a live Mongoose document's
// schema-typed (ObjectId ref) `people` path gets silently CAST back down to
// bare ObjectId strings on serialization — every 1:1 DM and group
// participant list looked like "Deleted User" client-side as a result,
// completely independent of whether any account was actually deleted. Every
// route that returns `people` must return real populated {_id, firstName,
// ...} objects, verified directly on the HTTP response body, not just on
// the in-memory Mongoose object (which is exactly what let this slip
// through undetected for as long as it did). See DECISIONS.md D-036.
describe('People array is genuinely populated on the wire (not cast back to bare ids)', () => {
  it('POST /api/room/join returns real {_id, firstName} objects, not id strings', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    expect(res.status).toBe(200);
    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other).toBeDefined();
    expect(other.firstName).toBe('Adarsh');
  });

  it('POST /api/room/get returns real {_id, firstName} objects, not id strings', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });

    const res = await request(app).post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    expect(res.status).toBe(200);
    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other).toBeDefined();
    expect(other.firstName).toBe('Adarsh');
  });

  it('POST /api/rooms/list returns real {_id, firstName} objects for every room', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ roomID: room._id.toString(), content: 'hi', type: 'text' });

    const res = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`);

    expect(res.status).toBe(200);
    const listedRoom = res.body.rooms.find((r) => r._id === room._id.toString());
    expect(listedRoom).toBeDefined();
    const other = listedRoom.people.find((p) => p._id === a._id.toString());
    expect(other).toBeDefined();
    expect(other.firstName).toBe('Adarsh');
  });

  it('POST /api/favorites/list returns real {_id, firstName} objects', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await request(app).post('/api/favorite/toggle')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ roomID: room._id.toString() });

    const res = await request(app).post('/api/favorites/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`);

    expect(res.status).toBe(200);
    const other = res.body.favorites[0].people.find((p) => p._id === a._id.toString());
    expect(other).toBeDefined();
    expect(other.firstName).toBe('Adarsh');
  });
});

// Regression coverage for a real leak: every route returning a populated
// person object used the same '-email -password -friends -__v' exclusion
// select, which never excluded vaultPinHash — the argon2 hash of a user's
// Private Vault PIN was shipped to every conversation partner/room list
// viewer. Fixed across all 19+ call sites; these tests lock in that a
// vault-configured user's hash never appears in any of these responses.
describe('vaultPinHash never leaks through a populated person object', () => {
  it('is absent from POST /api/room/join', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    await setUpVaultPin(a);
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other.vaultPinHash).toBeUndefined();
  });

  it('is absent from POST /api/room/get', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    await setUpVaultPin(a);
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });

    const res = await request(app).post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other.vaultPinHash).toBeUndefined();
  });

  it('is absent from POST /api/rooms/list', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    await setUpVaultPin(a);
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ roomID: room._id.toString(), content: 'hi', type: 'text' });

    const res = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`);

    const listedRoom = res.body.rooms.find((r) => r._id === room._id.toString());
    const other = listedRoom.people.find((p) => p._id === a._id.toString());
    expect(other.vaultPinHash).toBeUndefined();
  });

  it('is absent from POST /api/favorites/list', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    await setUpVaultPin(a);
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    await request(app).post('/api/favorite/toggle')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ roomID: room._id.toString() });

    const res = await request(app).post('/api/favorites/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`);

    const other = res.body.favorites[0].people.find((p) => p._id === a._id.toString());
    expect(other.vaultPinHash).toBeUndefined();
  });
});

// The "no unblock option" bug: /api/unblock existed server-side already, but
// nothing ever told the frontend whether the current room's other
// participant was blocked, so the menu had no way to show "Unblock" instead
// of "Block". Every route that returns `people` now attaches
// blockedByMe/blockedMe per person — these tests lock in that both flags
// appear (or correctly don't) on the wire for all four routes.
describe('blockedByMe / blockedMe flags on populated person objects', () => {
  it('POST /api/room/join marks the other person blockedByMe after I block them', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });
    await Relationship.create({
      requester: b._id, recipient: a._id, status: 'blocked', blockedBy: b._id,
    });

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other.blockedByMe).toBe(true);
    expect(other.blockedMe).toBe(false);
  });

  it('POST /api/room/join marks the other person blockedMe when they blocked me instead', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });
    await Relationship.create({
      requester: a._id, recipient: b._id, status: 'blocked', blockedBy: a._id,
    });

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other.blockedByMe).toBe(false);
    expect(other.blockedMe).toBe(true);
  });

  it('POST /api/room/get reflects the same blockedByMe state', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });
    await Relationship.create({
      requester: b._id, recipient: a._id, status: 'blocked', blockedBy: b._id,
    });

    const res = await request(app).post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other.blockedByMe).toBe(true);
  });

  it('POST /api/rooms/list reflects blockedByMe for the listed room', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ roomID: room._id.toString(), content: 'hi', type: 'text' });
    await Relationship.create({
      requester: b._id, recipient: a._id, status: 'blocked', blockedBy: b._id,
    });

    const res = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`);

    const listedRoom = res.body.rooms.find((r) => r._id === room._id.toString());
    const other = listedRoom.people.find((p) => p._id === a._id.toString());
    expect(other.blockedByMe).toBe(true);
  });

  it('POST /api/favorites/list reflects blockedByMe for the favorited room', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });
    await request(app).post('/api/favorite/toggle')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ roomID: room._id.toString() });
    await Relationship.create({
      requester: b._id, recipient: a._id, status: 'blocked', blockedBy: b._id,
    });

    const res = await request(app).post('/api/favorites/list')
      .set('Authorization', `Bearer ${tokenFor(b)}`);

    const other = res.body.favorites[0].people.find((p) => p._id === a._id.toString());
    expect(other.blockedByMe).toBe(true);
  });

  it('a non-blocked relationship leaves both flags absent (regression check)', async () => {
    const a = await createUser({ firstName: 'Adarsh' });
    const b = await createUser({ firstName: 'Demo' });
    const room = await Room.create({ people: [a._id, b._id], isGroup: false, lastMessage: null });

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ id: room._id.toString() });

    const other = res.body.room.people.find((p) => p._id === a._id.toString());
    expect(other.blockedByMe).toBeUndefined();
    expect(other.blockedMe).toBeUndefined();
  });
});
