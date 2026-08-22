const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Meeting = require('../src/models/Meeting');
const MeetingUserState = require('../src/models/MeetingUserState');

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
  });
};

describe('POST /api/meeting/delete', () => {
  it('removes a finished meeting from the requesting user\'s history', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await Meeting.create({
      users: [userA._id, userB._id], peers: [], caller: userA._id, callee: userB._id,
    });

    const res = await request(app).post('/api/meeting/delete')
      .set('Authorization', `Bearer ${tokenFor(userA)}`)
      .send({ meetingId: meeting._id.toString() });
    expect(res.status).toBe(200);

    const state = await MeetingUserState.findOne({ meeting: meeting._id, user: userA._id });
    expect(state.deletedAt).not.toBeNull();

    const listRes = await request(app).post('/api/meeting/list')
      .set('Authorization', `Bearer ${tokenFor(userA)}`);
    expect(listRes.body.meetings.find((m) => m._id === meeting._id.toString())).toBeUndefined();
  });

  it('does not remove the meeting from the OTHER participant\'s history', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await Meeting.create({
      users: [userA._id, userB._id], peers: [], caller: userA._id, callee: userB._id,
    });

    await request(app).post('/api/meeting/delete')
      .set('Authorization', `Bearer ${tokenFor(userA)}`)
      .send({ meetingId: meeting._id.toString() });

    const listRes = await request(app).post('/api/meeting/list')
      .set('Authorization', `Bearer ${tokenFor(userB)}`);
    expect(listRes.body.meetings.find((m) => m._id === meeting._id.toString())).toBeDefined();
  });

  it('rejects deleting an active meeting (someone currently in the call)', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await Meeting.create({
      users: [userA._id, userB._id], peers: [{ id: 'peer-1' }], caller: userA._id, callee: userB._id,
    });

    const res = await request(app).post('/api/meeting/delete')
      .set('Authorization', `Bearer ${tokenFor(userA)}`)
      .send({ meetingId: meeting._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('meeting_active');

    const state = await MeetingUserState.findOne({ meeting: meeting._id, user: userA._id });
    expect(state).toBeNull();
  });

  it('rejects a non-participant deleting a meeting they were never part of', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const outsider = await createUser();
    const meeting = await Meeting.create({
      users: [userA._id, userB._id], peers: [], caller: userA._id, callee: userB._id,
    });

    const res = await request(app).post('/api/meeting/delete')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ meetingId: meeting._id.toString() });
    expect(res.status).toBe(403);
  });

  it('is idempotent — deleting an already-deleted meeting from history is a no-op success', async () => {
    const userA = await createUser();
    const meeting = await Meeting.create({ users: [userA._id], peers: [] });

    const first = await request(app).post('/api/meeting/delete')
      .set('Authorization', `Bearer ${tokenFor(userA)}`)
      .send({ meetingId: meeting._id.toString() });
    const second = await request(app).post('/api/meeting/delete')
      .set('Authorization', `Bearer ${tokenFor(userA)}`)
      .send({ meetingId: meeting._id.toString() });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const count = await MeetingUserState.countDocuments({ meeting: meeting._id, user: userA._id });
    expect(count).toBe(1);
  });
});
