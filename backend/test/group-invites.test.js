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

  // Regression: the joiner was correctly added to Room.people/GroupMember,
  // but the socket broadcast used the PRE-join room.people snapshot (which
  // never includes the joiner) — so their own client never got the event
  // that triggers its sidebar refresh, making the group invisible on their
  // side despite having actually joined. See DECISIONS.md.
  it('the group appears in the joiner\'s own inbox right after joining', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id);
    const token = tokenFromUrl(created.body.url);

    await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);

    const list = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(joiner)}`)
      .send({});
    expect(list.body.rooms.map((r) => r._id)).toContain(group.body._id);
  });

  // Regression: a user who once deleted this group from their inbox
  // (ConversationUserState.deletedAt), left/was removed, then rejoins via
  // a fresh invite link stayed permanently invisible in rooms/list — the
  // stale deletedAt tombstone was never cleared by anything on rejoin,
  // unlike message.js's un-delete-on-new-message behavior for DMs. Real
  // repro: remove -> delete from inbox -> rejoin via invite -> group must
  // reappear. See unhideConversationForUser.js.
  it('reappears in the inbox after being deleted, then removed, then rejoined via a fresh invite', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const group = await createGroup(owner, [joiner._id]);
    const groupId = group.body._id;

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: joiner._id.toString() });

    await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(joiner)}`)
      .send({ conversationId: groupId });

    const listBeforeRejoin = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(joiner)}`)
      .send({});
    expect(listBeforeRejoin.body.rooms.map((r) => r._id)).not.toContain(groupId);

    const created = await createInvite(owner, groupId);
    const token = tokenFromUrl(created.body.url);
    const rejoin = await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);
    expect(rejoin.status).toBe(200);

    const listAfterRejoin = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(joiner)}`)
      .send({});
    expect(listAfterRejoin.body.rooms.map((r) => r._id)).toContain(groupId);
  });

  // Regression: after a delete-then-rejoin, the sidebar preview kept
  // showing the last message from BEFORE the rejoin (e.g. a stale "X was
  // removed by Y" moderation message) as if it were current activity —
  // even though that same message is correctly hidden once the
  // conversation is actually opened (more-messages.js/join-room.js both
  // already respect deletedBefore). list-rooms.js must apply the same
  // cutoff to lastMessage.
  it('nulls out a stale lastMessage in rooms/list after delete-then-rejoin, until new activity happens', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const group = await createGroup(owner, [joiner._id]);
    const groupId = group.body._id;

    await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ roomID: groupId, content: 'old message before removal', type: 'text' });

    await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: joiner._id.toString() });
    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(joiner)}`)
      .send({ conversationId: groupId });

    const created = await createInvite(owner, groupId);
    const token = tokenFromUrl(created.body.url);
    await request(app).post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);

    // The rejoin itself posts a fresh "joined via invite link" system
    // message — genuinely new activity after the cutoff, so it's the
    // correct lastMessage to show. The regression this guards is the OLD
    // pre-removal message ("old message before removal") never leaking
    // back in as the preview.
    const list = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(joiner)}`).send({});
    const row = list.body.rooms.find((r) => r._id === groupId);
    expect(row).toBeDefined();
    expect(row.lastMessage).not.toBeNull();
    expect(row.lastMessage.content).not.toBe('old message before removal');
    expect(row.lastMessage.content).toContain('joined via invite link');

    // A different user (owner) has no delete-then-rejoin cutoff of their
    // own — the fix must be per-user, not a global mutation of
    // Room.lastMessage — but they see the same latest message either way
    // since it's genuinely the newest activity for everyone.
    const ownerList = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({});
    const ownerRow = ownerList.body.rooms.find((r) => r._id === groupId);
    expect(ownerRow.lastMessage).not.toBeNull();
  });

  // Same regression, but with genuinely nothing after the cutoff (a direct
  // re-add posts no system message today) — the actual "everything is
  // hidden" case list-rooms.js must null out, not just correctly show
  // newer activity when there happens to be some.
  it('nulls out lastMessage entirely when every message predates the cutoff and no new activity exists', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);
    const groupId = group.body._id;

    await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ roomID: groupId, content: 'old message before removal', type: 'text' });

    await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: target._id.toString() });
    await request(app).post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ conversationId: groupId });

    await request(app).post('/api/group/members/add')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: target._id.toString() });

    const list = await request(app).post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(target)}`).send({});
    const row = list.body.rooms.find((r) => r._id === groupId);
    expect(row).toBeDefined();
    expect(row.lastMessage).toBeNull();
  });

  it('posts an inline system message naming the joiner and the inviter', async () => {
    const owner = await createUser({ firstName: 'Priya', lastName: 'Owner', username: 'priyaowner' });
    const joiner = await createUser({ firstName: 'Rahul', lastName: 'Joiner', username: 'rahuljoiner' });
    const group = await createGroup(owner);
    const created = await createInvite(owner, group.body._id);
    const token = tokenFromUrl(created.body.url);

    await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);

    const Message = require('../src/models/Message');
    const systemMessage = await Message.findOne({ room: group.body._id, type: 'system' });
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toBe('Rahul Joiner joined via invite link, invited by Priya Owner');
  });
});

describe('Group invite revocation', () => {
  it('rejects revocation by a plain MEMBER, even for their own invite', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    const created = await createInvite(member, group.body._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/group/invites/${token}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(member)}`);
    expect(res.status).toBe(403);
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
