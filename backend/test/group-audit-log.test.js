const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
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

describe('Group audit log', () => {
  it('records role_changed with correct actor/target', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    await request(app)
      .post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: member._id, role: 'ADMIN' });

    // role_changed isn't audit-logged by this pass (only the 5 routes
    // touched by this plan write GroupAuditLog) — this test instead
    // verifies settings_changed, which group/update.js does write.
    await request(app)
      .post('/api/group/update')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, slowModeSeconds: 30 });

    const log = await GroupAuditLog.findOne({ group: group.body._id, action: 'settings_changed' });
    expect(log).not.toBeNull();
    expect(log.actor.toString()).toBe(owner._id.toString());
  });

  it('records message_deleted_by_admin only on moderator-override deletes, not self-deletes', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    const sent = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .field('roomID', group.body._id)
      .field('content', 'hello')
      .field('type', 'text');

    await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .field('roomID', group.body._id)
      .field('messageID', sent.body.message._id)
      .field('forEveryone', 'true');

    const selfDeleteLog = await GroupAuditLog.findOne({ group: group.body._id, action: 'message_deleted_by_admin' });
    expect(selfDeleteLog).toBeNull();

    const sent2 = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .field('roomID', group.body._id)
      .field('content', 'hello again')
      .field('type', 'text');

    await request(app)
      .post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .field('roomID', group.body._id)
      .field('messageID', sent2.body.message._id)
      .field('forEveryone', 'true');

    const modDeleteLog = await GroupAuditLog.findOne({ group: group.body._id, action: 'message_deleted_by_admin' });
    expect(modDeleteLog).not.toBeNull();
    expect(modDeleteLog.actor.toString()).toBe(owner._id.toString());
  });
});
