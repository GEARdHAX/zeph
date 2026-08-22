const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Image = require('../src/models/Image');
const Room = require('../src/models/Room');

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
    level: 'standard',
    password,
    ...overrides,
  });
};

describe('POST /api/picture/change', () => {
  it('sets a new profile picture', async () => {
    const user = await createUser();
    const image = await Image.create({ shieldedID: 'abc123' });

    const res = await request(app).post('/api/picture/change')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ imageID: image._id.toString() });

    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.picture.toString()).toBe(image._id.toString());
  });
});

describe('POST /api/picture/remove', () => {
  it('actually clears the picture field in the database (regression: $set to undefined was previously a no-op)', async () => {
    const image = await Image.create({ shieldedID: 'abc123' });
    const user = await createUser({ picture: image._id });

    const res = await request(app).post('/api/picture/remove')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.picture).toBeFalsy();
  });

  it('does not error when the user shares rooms with other people (notification path)', async () => {
    const image = await Image.create({ shieldedID: 'abc123' });
    const user = await createUser({ picture: image._id });
    const other = await createUser();
    await Room.create({ people: [user._id, other._id], isGroup: false });

    const res = await request(app).post('/api/picture/remove')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.picture).toBeFalsy();
  });
});
