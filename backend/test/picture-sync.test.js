const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Image = require('../src/models/Image');
const store = require('../src/store');

// A picture changed on one device must reach the user's other sessions: otherwise they keep the old
// (now deleted) picture in their stored profile and show a blank avatar.
let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});
afterAll(async () => {
  await db.closeDatabase();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await db.clearDatabase();
});

const createUser = async (overrides = {}) =>
  User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    level: 'standard',
    password: await argon2.hash('password123'),
    ...overrides,
  });

describe('POST /api/check-user reports the current picture (used at app start to correct a stale browser)', () => {
  it('returns the picture reference for a user who has one', async () => {
    const user = await createUser();
    const image = await Image.create({ author: user._id, shieldedID: 'current-shield', storageKey: `public/users/${user._id}/avatar/current-shield.jpg` });
    await User.updateOne({ _id: user._id }, { picture: image._id });

    const res = await request(app).post('/api/check-user').send({ token: tokenFor(user) });

    expect(res.body.valid).toBe(true);
    expect(res.body.picture).toEqual({ _id: image._id.toString(), shieldedID: 'current-shield' });
  });

  it('returns picture: null when there is none, so a stale browser drops the old one', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/check-user').send({ token: tokenFor(user) });
    expect(res.body).toEqual({ valid: true, picture: null });
  });

  it('exposes nothing else about the account', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/check-user').send({ token: tokenFor(user) });
    expect(Object.keys(res.body).sort()).toEqual(['picture', 'valid']);
  });
});

describe('POST /api/picture/change notifies the user\'s own other sessions', () => {
  it('emits user-profile-updated to the user\'s personal room with the new picture', async () => {
    const user = await createUser();
    const image = await Image.create({ author: user._id, shieldedID: 'new-shield' });
    const emitted = [];
    jest.spyOn(store.io, 'to').mockImplementation((room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }));

    const res = await request(app)
      .post('/api/picture/change')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ imageID: image._id.toString() });

    expect(res.status).toBe(200);
    const own = emitted.find((e) => e.room === user._id.toString() && e.event === 'user-profile-updated');
    expect(own).toBeDefined();
    expect(own.payload.userId.toString()).toBe(user._id.toString());
    expect(own.payload.picture.shieldedID).toBe('new-shield');
  });

  it('tells the user\'s other sessions (picture: null) when the picture is removed', async () => {
    const image = await Image.create({ shieldedID: 'gone-shield' });
    const user = await createUser({ picture: image._id });
    const emitted = [];
    jest.spyOn(store.io, 'to').mockImplementation((room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }));

    await request(app).post('/api/picture/remove').set('Authorization', `Bearer ${tokenFor(user)}`).send({});

    const own = emitted.find((e) => e.room === user._id.toString() && e.event === 'user-profile-updated');
    expect(own.payload.picture).toBeNull();
  });
});
