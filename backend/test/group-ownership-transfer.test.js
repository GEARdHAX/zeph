const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
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

const transfer = (actor, groupId, userId) => request(app)
  .post('/api/group/ownership/transfer')
  .set('Authorization', `Bearer ${tokenFor(actor)}`)
  .send({ groupId, userId });

describe('Ownership transfer', () => {
  it('moves OWNER role, demotes old owner to ADMIN, updates Room.ownerId', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    const res = await transfer(owner, group.body._id, member._id);
    expect(res.status).toBe(200);

    const newOwnerRow = await GroupMember.findOne({ group: group.body._id, user: member._id });
    expect(newOwnerRow.role).toBe('OWNER');
    const oldOwnerRow = await GroupMember.findOne({ group: group.body._id, user: owner._id });
    expect(oldOwnerRow.role).toBe('ADMIN');

    const room = await Room.findById(group.body._id);
    expect(room.ownerId.toString()).toBe(member._id.toString());

    const log = await GroupAuditLog.findOne({ group: group.body._id, action: 'ownership_transferred' });
    expect(log.target.toString()).toBe(member._id.toString());
  });

  it('rejects transfer by a non-owner', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [admin._id, member._id]);
    await GroupMember.updateOne({ group: group.body._id, user: admin._id }, { $set: { role: 'ADMIN' } });

    const res = await transfer(admin, group.body._id, member._id);
    expect(res.status).toBe(403);
  });

  it('rejects transferring to a non-member', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const group = await createGroup(owner);

    const res = await transfer(owner, group.body._id, outsider._id);
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('TARGET_NOT_MEMBER');
  });

  it('rejects transferring to self', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await transfer(owner, group.body._id, owner._id);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('ALREADY_OWNER');
  });
});
