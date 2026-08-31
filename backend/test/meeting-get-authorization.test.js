const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Meeting = require('../src/models/Meeting');

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

const createUser = async () => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

// Phase 9 audit finding, CRITICAL (compounds the mediasoup join fix — see
// mediasoup-join-authorization.test.js): POST /api/meeting/get previously
// created a Meeting from a fully client-supplied `group` (Room id) with no
// verification the caller belongs to it — an attacker could fabricate a
// Meeting naming any group and, combined with the join-time gap, enter it.
describe('POST /api/meeting/get — group membership authorization', () => {
  it('rejects creating a meeting for a group the caller is not a member of', async () => {
    const attacker = await createUser();
    const memberA = await createUser();
    const memberB = await createUser();
    const room = await Room.create({ people: [memberA._id, memberB._id], isGroup: true, title: 'Private Group' });

    const res = await request(app)
      .post('/api/meeting/get')
      .set('Authorization', `Bearer ${tokenFor(attacker)}`)
      .send({
        startedAsCall: true, callToGroup: true, group: room._id.toString(),
      });

    expect(res.status).toBe(403);
    const count = await Meeting.countDocuments({ group: room._id });
    expect(count).toBe(0);
  });

  it('rejects a non-existent group id', async () => {
    const caller = await createUser();

    const res = await request(app)
      .post('/api/meeting/get')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ startedAsCall: true, group: '000000000000000000000000' });

    expect(res.status).toBe(404);
  });

  it('allows a real member to create a meeting for their own group', async () => {
    const owner = await createUser();
    const member = await createUser();
    const room = await Room.create({ people: [owner._id, member._id], isGroup: true, title: 'Group' });

    const res = await request(app)
      .post('/api/meeting/get')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({
        startedAsCall: true, callToGroup: true, group: room._id.toString(), callee: owner._id.toString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.group).toBe(room._id.toString());
  });

  it('allows creating a meeting for a real 1:1 DM room the caller belongs to', async () => {
    const caller = await createUser();
    const other = await createUser();
    const room = await Room.create({ people: [caller._id, other._id], isGroup: false });

    const res = await request(app)
      .post('/api/meeting/get')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({
        startedAsCall: true, callee: other._id.toString(), group: room._id.toString(),
      });

    expect(res.status).toBe(200);
  });

  it('requires a group field at all', async () => {
    const caller = await createUser();

    const res = await request(app)
      .post('/api/meeting/get')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ startedAsCall: true });

    expect(res.status).toBe(400);
  });
});
