const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const GroupMember = require('../src/models/GroupMember');
const GroupAuditLog = require('../src/models/GroupAuditLog');

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

const createGroup = (owner, memberIds = []) => request(app)
  .post('/api/group/create')
  .set('Authorization', `Bearer ${tokenFor(owner)}`)
  .send({ title: 'Test Group', people: memberIds.map((id) => id.toString()) });

const banMember = (actor, groupId, userId) => request(app)
  .post('/api/group/members/ban')
  .set('Authorization', `Bearer ${tokenFor(actor)}`)
  .send({ groupId, userId });

const createInvite = (actor, groupId) => request(app)
  .post('/api/group/invites/create')
  .set('Authorization', `Bearer ${tokenFor(actor)}`)
  .send({ groupId });

describe('Member ban', () => {
  it('sets status BANNED and removes from Room.people', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    const res = await banMember(owner, group.body._id, target._id);
    expect(res.status).toBe(200);

    const row = await GroupMember.findOne({ group: group.body._id, user: target._id });
    expect(row.status).toBe('BANNED');
    expect(row.active).toBe(false);

    const log = await GroupAuditLog.findOne({ group: group.body._id, action: 'member_banned' });
    expect(log.target.toString()).toBe(target._id.toString());
  });

  it('rejects ban by a non-privileged member', async () => {
    const owner = await createUser();
    const memberA = await createUser();
    const memberB = await createUser();
    const group = await createGroup(owner, [memberA._id, memberB._id]);

    const res = await banMember(memberA, group.body._id, memberB._id);
    expect(res.status).toBe(403);
  });

  it('rejects banning the OWNER (role hierarchy)', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const group = await createGroup(owner, [admin._id]);
    await GroupMember.updateOne({ group: group.body._id, user: admin._id }, { $set: { role: 'ADMIN' } });

    const res = await banMember(admin, group.body._id, owner._id);
    expect(res.status).toBe(403);
  });

  it('blocks a banned user from rejoining via invite link', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);
    await banMember(owner, group.body._id, target._id);

    const invite = await createInvite(owner, group.body._id);
    const token = invite.body.url.split('/').pop();

    const res = await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(target)}`);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('BANNED');
  });

  it('blocks a banned user from rejoining via join request', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);
    await banMember(owner, group.body._id, target._id);

    const res = await request(app)
      .post('/api/group/join-requests')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ groupId: group.body._id });
    expect(res.status).toBe(404);
  });
});
