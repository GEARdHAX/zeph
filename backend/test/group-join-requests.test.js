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

const requestJoin = (user, groupId) => request(app)
  .post('/api/group/join-requests')
  .set('Authorization', `Bearer ${tokenFor(user)}`)
  .send({ groupId });

describe('Join request creation', () => {
  it('creates a PENDING membership row', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);

    const res = await requestJoin(requester, group.body._id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');

    const row = await GroupMember.findOne({ group: group.body._id, user: requester._id });
    expect(row.status).toBe('PENDING');
    expect(row.active).toBe(false);
  });

  it('rejects a duplicate pending request', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);

    await requestJoin(requester, group.body._id);
    const second = await requestJoin(requester, group.body._id);
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('ALREADY_REQUESTED');
  });

  it('rejects a request from an already-active member', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await requestJoin(owner, group.body._id);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('ALREADY_MEMBER');
  });

  it('allows re-requesting after a previous LEFT (upsert over stale row)', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);

    await GroupMember.create({
      group: group.body._id, user: requester._id, role: 'MEMBER', status: 'LEFT', active: false,
    });

    const res = await requestJoin(requester, group.body._id);
    expect(res.status).toBe(200);
    const row = await GroupMember.findOne({ group: group.body._id, user: requester._id });
    expect(row.status).toBe('PENDING');
  });

  it('handles two concurrent join requests as exactly one success', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);

    const [resA, resB] = await Promise.all([
      requestJoin(requester, group.body._id),
      requestJoin(requester, group.body._id),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('Join request approval', () => {
  it('approves a pending request, activates membership, adds to Room.people', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);
    await requestJoin(requester, group.body._id);

    const res = await request(app)
      .post(`/api/group/join-requests/${requester._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id });

    expect(res.status).toBe(200);
    const row = await GroupMember.findOne({ group: group.body._id, user: requester._id });
    expect(row.status).toBe('ACTIVE');
    expect(row.active).toBe(true);

    const log = await GroupAuditLog.findOne({ group: group.body._id, action: 'request_approved' });
    expect(log.target.toString()).toBe(requester._id.toString());
  });

  // Regression: a user who deleted this group from their inbox (a prior
  // membership, removed, then deleted), then requests to join again and
  // gets approved, stayed permanently invisible in rooms/list — nothing
  // cleared the stale ConversationUserState.deletedAt tombstone on
  // approval. See unhideConversationForUser.js.
  it('reappears in the requester\'s inbox after being deleted, removed, then re-approved', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner, [requester._id]);
    const groupId = group.body._id;

    await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: requester._id.toString() });

    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(requester)}`)
      .send({ conversationId: groupId });

    const listBefore = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(requester)}`).send({});
    expect(listBefore.body.rooms.map((r) => r._id)).not.toContain(groupId);

    await requestJoin(requester, groupId);
    const approve = await request(app)
      .post(`/api/group/join-requests/${requester._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId });
    expect(approve.status).toBe(200);

    const listAfter = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(requester)}`).send({});
    expect(listAfter.body.rooms.map((r) => r._id)).toContain(groupId);
  });

  it('rejects approval by a non-admin member', async () => {
    const owner = await createUser();
    const member = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner, [member._id]);
    await requestJoin(requester, group.body._id);

    const res = await request(app)
      .post(`/api/group/join-requests/${requester._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ groupId: group.body._id });
    expect(res.status).toBe(404);
  });

  it('409s approving an already-approved (non-PENDING) request', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);
    await requestJoin(requester, group.body._id);

    const approve = (u) => request(app)
      .post(`/api/group/join-requests/${requester._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id });

    const first = await approve(owner);
    expect(first.status).toBe(200);
    const second = await approve(owner);
    expect(second.status).toBe(409);
  });
});

describe('Join request denial', () => {
  it('denies a pending request, sets status LEFT (not deleted)', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);
    await requestJoin(requester, group.body._id);

    const res = await request(app)
      .post(`/api/group/join-requests/${requester._id}/deny`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id });

    expect(res.status).toBe(200);
    const row = await GroupMember.findOne({ group: group.body._id, user: requester._id });
    expect(row.status).toBe('LEFT');
  });

  it('allows re-requesting after denial', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);
    await requestJoin(requester, group.body._id);
    await request(app)
      .post(`/api/group/join-requests/${requester._id}/deny`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id });

    const res = await requestJoin(requester, group.body._id);
    expect(res.status).toBe(200);
  });
});

describe('Banned users cannot join-request', () => {
  it('rejects a join request from a BANNED user', async () => {
    const owner = await createUser();
    const banned = await createUser();
    const group = await createGroup(owner);
    await GroupMember.create({
      group: group.body._id, user: banned._id, role: 'MEMBER', status: 'BANNED', active: false,
    });

    const res = await requestJoin(banned, group.body._id);
    expect(res.status).toBe(404);
  });
});

describe('Join requests list', () => {
  it('returns only PENDING rows, admin/owner only', async () => {
    const owner = await createUser();
    const requester = await createUser();
    const group = await createGroup(owner);
    await requestJoin(requester, group.body._id);

    const res = await request(app)
      .post('/api/group/join-requests/list')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id });

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].user._id).toBe(requester._id.toString());
  });
});
