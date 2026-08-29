const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const store = require('../src/store');
const User = require('../src/models/User');
const Relationship = require('../src/models/Relationship');

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
    password,
  });
};

// Both routes emit inside a .then() after the HTTP response's own async
// work — the emit is fire-and-forget by design (a slow/failed emit must
// never delay or fail the request itself), so tests poll briefly instead
// of asserting synchronously right after the response comes back.
const waitFor = async (assertion, { timeoutMs = 1000, intervalMs = 20 } = {}) => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
    }
  }
};

describe('Friend request realtime notifications', () => {
  it('POST /api/friend-requests emits friend-request:received to the recipient with the requester\'s public profile', async () => {
    const me = await createUser({ username: 'Alice', firstName: 'Alice', lastName: 'A' });
    const rohan = await createUser({ username: 'Rohan' });
    const emitSpy = jest.fn();
    store.io.to = jest.fn(() => ({ emit: emitSpy }));

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan');
    expect(res.status).toBe(200);

    await waitFor(() => {
      expect(store.io.to).toHaveBeenCalledWith(rohan._id.toString());
      expect(emitSpy).toHaveBeenCalledWith('friend-request:received', expect.objectContaining({
        requester: expect.objectContaining({ username: 'Alice', firstName: 'Alice' }),
      }));
    });
  });

  it('does not emit when the request is rejected (duplicate pending)', async () => {
    const me = await createUser({ username: 'Bob' });
    const rohan = await createUser({ username: 'Rohan2' });
    await Relationship.create({ requester: me._id, recipient: rohan._id, status: 'pending' });
    const emitSpy = jest.fn();
    store.io.to = jest.fn(() => ({ emit: emitSpy }));

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan2');
    expect(res.status).toBe(409);

    // Give any stray async work a moment, then confirm nothing fired.
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(store.io.to).not.toHaveBeenCalled();
  });

  it('POST /api/friend-requests/:id/accept emits friend-request:accepted to the original requester', async () => {
    const requester = await createUser({ username: 'Carol' });
    const recipient = await createUser({ username: 'Dave', firstName: 'Dave', lastName: 'D' });
    const relationship = await Relationship.create({ requester: requester._id, recipient: recipient._id, status: 'pending' });
    const emitSpy = jest.fn();
    store.io.to = jest.fn(() => ({ emit: emitSpy }));

    const res = await request(app)
      .post(`/api/friend-requests/${relationship._id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);
    expect(res.status).toBe(200);

    await waitFor(() => {
      expect(store.io.to).toHaveBeenCalledWith(requester._id.toString());
      expect(emitSpy).toHaveBeenCalledWith('friend-request:accepted', expect.objectContaining({
        accepter: expect.objectContaining({ username: 'Dave', firstName: 'Dave' }),
      }));
    });
  });

  it('does not emit when accept is rejected (not the recipient / not pending)', async () => {
    const requester = await createUser({ username: 'Eve' });
    const recipient = await createUser({ username: 'Frank' });
    const bystander = await createUser({ username: 'Grace' });
    const relationship = await Relationship.create({ requester: requester._id, recipient: recipient._id, status: 'pending' });
    const emitSpy = jest.fn();
    store.io.to = jest.fn(() => ({ emit: emitSpy }));

    const res = await request(app)
      .post(`/api/friend-requests/${relationship._id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(bystander)}`);
    expect(res.status).toBe(404);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(store.io.to).not.toHaveBeenCalled();
  });
});
