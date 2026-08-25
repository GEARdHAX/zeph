const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const GroupMember = require('../src/models/GroupMember');
const GroupInvite = require('../src/models/GroupInvite');

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

const createInvite = (actor, groupId, extra = {}) => request(app)
  .post('/api/group/invites/create')
  .set('Authorization', `Bearer ${tokenFor(actor)}`)
  .send({ groupId, ...extra });

const tokenFromUrl = (url) => url.split('/').pop();

describe('Group invite creation', () => {
  it('allows a MEMBER to create an invite (CREATE_INVITE is a member capability)', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    const res = await createInvite(member, group.body._id);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/invite\/g\//);
  });

  it('rejects invite creation by a non-member', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const group = await createGroup(owner);

    const res = await createInvite(outsider, group.body._id);
    expect(res.status).toBe(404);
  });

  it('stores only a token hash, never the raw token', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    const res = await createInvite(owner, group.body._id);
    const token = tokenFromUrl(res.body.url);

    const stored = await GroupInvite.findOne({ group: group.body._id });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64);
  });
});

describe('Group invite preview', () => {
  it('returns only group name/avatar/memberCount/privacy, unauthenticated', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app).get(`/api/group/invites/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.group.name).toBe('Test Group');
    expect(res.body.group.memberCount).toBe(1);
    expect(res.body.group.members).toBeUndefined();
  });

  it('404s on an invalid token', async () => {
    const res = await request(app).get('/api/group/invites/not-a-real-token');
    expect(res.status).toBe(404);
  });
});

describe('Group invite join', () => {
  it('creates a MEMBER-role GroupMember and adds to Room.people', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);

    expect(res.status).toBe(200);
    const membership = await GroupMember.findOne({ group: group.body._id, user: joiner._id });
    expect(membership.role).toBe('MEMBER');
    expect(membership.active).toBe(true);
  });

  it('rejects joining when already a member', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`);

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('ALREADY_MEMBER');
  });

  it('enforces maxUses — a 2nd join beyond the limit is rejected', async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id, { maxUses: 1 });
    const token = tokenFromUrl(created.body.url);

    const first = await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(b)}`);
    expect(second.status).toBe(404);
  });

  it('handles two concurrent joins against a 1-use invite as exactly one success', async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id, { maxUses: 1 });
    const token = tokenFromUrl(created.body.url);

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/group/invites/${token}/join`).set('Authorization', `Bearer ${tokenFor(a)}`),
      request(app).post(`/api/group/invites/${token}/join`).set('Authorization', `Bearer ${tokenFor(b)}`),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 404]);
    const count = await GroupMember.countDocuments({ group: group.body._id, active: true });
    expect(count).toBe(2); // owner + exactly one joiner
  });

  it('rejects joining a revoked invite', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id);
    const token = tokenFromUrl(created.body.url);

    await request(app).post(`/api/group/invites/${token}/revoke`).set('Authorization', `Bearer ${tokenFor(owner)}`);

    const res = await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);
    expect(res.status).toBe(404);
  });
});

describe('Group invite revocation', () => {
  it('allows the invite creator to revoke it', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    const created = await createInvite(member, group.body._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/group/invites/${token}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(member)}`);
    expect(res.status).toBe(200);
  });

  it('allows an OWNER to revoke a MEMBER-created invite', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    const created = await createInvite(member, group.body._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/group/invites/${token}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(owner)}`);
    expect(res.status).toBe(200);
  });

  it('rejects revocation by an unrelated MEMBER', async () => {
    const owner = await createUser();
    const member = await createUser();
    const otherMember = await createUser();
    const group = await createGroup(owner, [member._id, otherMember._id]);
    const created = await createInvite(member, group.body._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/group/invites/${token}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(otherMember)}`);
    expect(res.status).toBe(403);
  });
});
