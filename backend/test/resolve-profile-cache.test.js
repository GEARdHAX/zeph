require('dotenv').config();
const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const store = require('../src/store');
const config = require('../config');
const User = require('../src/models/User');
const { closeProfileCacheConnection } = require('../src/userProfileCache');

let app;

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await closeProfileCacheConnection();
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
  // buildApp() forces redisUrl:null (see test/helpers/app.js) so every
  // OTHER test file in the suite never touches real Redis — this file
  // deliberately opts back in per-test to prove the real caching path,
  // then restores the forced-null state so it doesn't leak into whichever
  // test file Jest runs next in the same worker.
  store.config = { ...config, redisUrl: null };
});

const createUser = async (overrides = {}) => {
  const password = await argon2.hash('password123');
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2)}`,
    email: overrides.email || `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    password,
  });
};

describeIfRedis('GET /api/users/:username — served from cache on a repeat request', () => {
  it('a bio update is reflected immediately (cache invalidated), not stale for the TTL window', async () => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };

    const me = await createUser();
    const target = await createUser({ username: `CacheTarget${Date.now()}` });

    const first = await request(app)
      .get(`/api/users/${target.username}`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    expect(first.status).toBe(200);
    expect(first.body.user.bio).toBeFalsy();

    await request(app)
      .post('/api/users/update-bio')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ bio: 'Now with a bio' });

    const second = await request(app)
      .get(`/api/users/${target.username}`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    expect(second.status).toBe(200);
    expect(second.body.user.bio).toBe('Now with a bio');
  });

  it('a username change moves the cache to the new key — old username 404s, new one resolves correctly', async () => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };

    const me = await createUser();
    const originalUsername = `OldName${Date.now()}`;
    const target = await createUser({ username: originalUsername });

    // Populate the cache under the OLD username.
    await request(app)
      .get(`/api/users/${originalUsername}`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    const newUsername = `NewName${Date.now()}`;
    const renameRes = await request(app)
      .post('/api/users/change-username')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ username: newUsername });
    expect(renameRes.status).toBe(200);

    const oldLookup = await request(app)
      .get(`/api/users/${originalUsername}`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    expect(oldLookup.status).toBe(404);

    const newLookup = await request(app)
      .get(`/api/users/${newUsername}`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    expect(newLookup.status).toBe(200);
    expect(newLookup.body.user.username).toBe(newUsername);
  });

  it('a picture change is reflected immediately, not stale for the TTL window', async () => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };

    const me = await createUser();
    const target = await createUser({ username: `PicTarget${Date.now()}` });

    const before = await request(app)
      .get(`/api/users/${target.username}`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    expect(before.body.user.picture).toBeFalsy();

    const Image = require('../src/models/Image');
    const image = await Image.create({
      shield: 'shield', name: 'pic.jpg', author: target._id, size: 100, shieldedID: 'shieldedid123',
    });

    await request(app)
      .post('/api/picture/change')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ imageID: image._id.toString() });

    const after = await request(app)
      .get(`/api/users/${target.username}`)
      .set('Authorization', `Bearer ${tokenFor(me)}`);
    expect(after.body.user.picture).toBeTruthy();
  });
});
