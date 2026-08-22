const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const ConversationUserState = require('../src/models/ConversationUserState');
const GroupMember = require('../src/models/GroupMember');
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
    level: overrides.level || 'standard',
    password,
  });
};
const createAdmin = (overrides = {}) => createUser({ ...overrides, level: 'root' });

const deleteUser = (admin, email) => request(app)
  .post('/api/user/delete')
  .set('Authorization', `Bearer ${tokenFor(admin)}`)
  .send({ email });

describe('Deleting a user cleans up their data for other participants', () => {
  it('removes a shared 1:1 DM from the other participant\'s inbox without deleting the Room or Messages', async () => {
    const admin = await createAdmin();
    const victim = await createUser();
    const survivor = await createUser();
    const room = await Room.create({ people: [victim._id, survivor._id], isGroup: false });
    await Message.create({ room: room._id, author: survivor._id, content: 'hi', type: 'text' });

    const res = await deleteUser(admin, victim.email);
    expect(res.status).toBe(200);

    const state = await ConversationUserState.findOne({ conversation: room._id, user: survivor._id });
    expect(state).not.toBeNull();
    expect(state.deletedAt).not.toBeNull();

    // Room and its messages are untouched — retention, not physical delete.
    const stillExists = await Room.findById(room._id);
    expect(stillExists).not.toBeNull();
    const messageCount = await Message.countDocuments({ room: room._id });
    expect(messageCount).toBe(1);

    // The survivor's normal inbox listing excludes it.
    const listRes = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(survivor)}`);
    expect(listRes.body.rooms.find((r) => r._id === room._id.toString())).toBeUndefined();
  });

  it('deactivates the deleted user\'s membership in any groups they belonged to', async () => {
    const admin = await createAdmin();
    const owner = await createUser();
    const victim = await createUser();

    const created = await request(app)
      .post('/api/group/create')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ title: 'Group', people: [victim._id.toString()] });
    const groupId = created.body._id;

    await deleteUser(admin, victim.email);

    const membership = await GroupMember.findOne({ group: groupId, user: victim._id });
    expect(membership.active).toBe(false);

    const room = await Room.findById(groupId);
    expect(room.people.map((p) => p.toString())).not.toContain(victim._id.toString());
  });

  it('removes friend-request/relationship rows referencing the deleted user', async () => {
    const admin = await createAdmin();
    const victim = await createUser();
    const other = await createUser();
    await Relationship.create({ requester: victim._id, recipient: other._id, status: 'pending' });

    await deleteUser(admin, victim.email);

    const remaining = await Relationship.countDocuments({
      $or: [{ requester: victim._id }, { recipient: victim._id }],
    });
    expect(remaining).toBe(0);
  });

  it('still deletes the user and responds 200 even if they had no rooms/relationships at all', async () => {
    const admin = await createAdmin();
    const victim = await createUser();

    const res = await deleteUser(admin, victim.email);
    expect(res.status).toBe(200);
    expect(await User.findById(victim._id)).toBeNull();
  });
});
