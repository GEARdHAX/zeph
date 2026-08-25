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
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    password,
  });
};

const createGroup = (owner, memberIds = []) => request(app)
  .post('/api/group/create')
  .set('Authorization', `Bearer ${tokenFor(owner)}`)
  .send({ title: 'Test Group', people: memberIds.map((id) => id.toString()) });

// The test harness's default store.io.to() stub (helpers/app.js) can't
// answer "was this delivered to a real recipient" — it accepts any target
// string. These tests replace it with a spy that records every `.to(id)`
// call, so a regression back to store.io.to(`group:${groupId}`) (a room
// nothing ever joins — see DECISIONS.md, utils/broadcastToGroup.js) shows
// up as "no per-user targets recorded" instead of silently passing.
describe('Group moderation events reach real per-user targets, not a dead group room', () => {
  let toSpyTargets;

  beforeEach(() => {
    toSpyTargets = [];
    store.io = {
      to: (target) => {
        toSpyTargets.push(target);
        return { emit: () => {} };
      },
      emit: () => {},
    };
  });

  afterAll(() => {
    // Restore the shared stub other test files in the same run rely on.
    store.io = { to: () => ({ emit: () => {} }), emit: () => {} };
  });

  it('member ban targets remaining members by user id, never a group:<id> room', async () => {
    const owner = await createUser();
    const target = await createUser();
    const bystander = await createUser();
    const group = await createGroup(owner, [target._id, bystander._id]);

    await request(app)
      .post('/api/group/members/ban')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id, userId: target._id });

    expect(toSpyTargets.some((t) => t.startsWith('group:'))).toBe(false);
    expect(toSpyTargets).toContain(bystander._id.toString());
  });

  it('role change targets remaining members by user id, never a group:<id> room', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    await request(app)
      .post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({
        id: group.body._id, userId: member._id, role: 'ADMIN',
      });

    expect(toSpyTargets.some((t) => t.startsWith('group:'))).toBe(false);
  });

  it('settings update targets remaining members by user id, never a group:<id> room', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    await request(app)
      .post('/api/group/update')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, slowModeSeconds: 30 });

    expect(toSpyTargets.some((t) => t.startsWith('group:'))).toBe(false);
    expect(toSpyTargets).toContain(member._id.toString());
  });

  it('join-via-invite targets existing members by user id, never a group:<id> room', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const group = await createGroup(owner);

    const invite = await request(app)
      .post('/api/group/invites/create')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id });
    const token = invite.body.url.split('/').pop();

    await request(app)
      .post(`/api/group/invites/${token}/join`)
      .set('Authorization', `Bearer ${tokenFor(joiner)}`);

    expect(toSpyTargets.some((t) => t.startsWith('group:'))).toBe(false);
    expect(toSpyTargets).toContain(owner._id.toString());
    // Regression: broadcastToGroup(room.people, ...) used room's PRE-join
    // snapshot, which never includes the joiner themselves — so the new
    // member's own client never got the socket event that triggers its
    // getRooms() refresh, and the group silently never appeared in their
    // own sidebar despite the join having actually succeeded in the DB.
    expect(toSpyTargets).toContain(joiner._id.toString());
  });
});
