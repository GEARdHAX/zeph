const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const store = require('../src/store');

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
    level: overrides.level || 'standard',
    password,
  });
};
const createAdmin = (overrides = {}) => createUser({ ...overrides, level: 'root' });

describe('Close authorization (meeting/close.js)', () => {
  it('emits close to the target when neither side is privileged (regression)', async () => {
    const caller = await createUser();
    const target = await createUser();
    const emitSpy = jest.fn();
    store.io.to = jest.fn(() => ({ emit: emitSpy }));

    const res = await request(app).post('/api/meeting/close')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ userID: target._id.toString(), meetingID: 'm1' });

    expect(res.status).toBe(200);
    expect(store.io.to).toHaveBeenCalledWith(target._id.toString());
    expect(emitSpy).toHaveBeenCalledWith('close', expect.objectContaining({ meetingID: 'm1' }));
  });

  it('silently no-ops (200, no emit) when a standard user targets a privileged account (admin boundary)', async () => {
    const caller = await createUser();
    const admin = await createAdmin();
    const emitSpy = jest.fn();
    store.io.to = jest.fn(() => ({ emit: emitSpy }));

    const res = await request(app).post('/api/meeting/close')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ userID: admin._id.toString(), meetingID: 'm1' });

    expect(res.status).toBe(200);
    expect(store.io.to).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('silently no-ops (200, no emit) when the target user does not exist', async () => {
    const caller = await createUser();
    const emitSpy = jest.fn();
    store.io.to = jest.fn(() => ({ emit: emitSpy }));

    const res = await request(app).post('/api/meeting/close')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ userID: '507f1f77bcf86cd799439011', meetingID: 'm1' });

    expect(res.status).toBe(200);
    expect(store.io.to).not.toHaveBeenCalled();
  });
});
