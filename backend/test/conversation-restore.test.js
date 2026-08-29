const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const ConversationUserState = require('../src/models/ConversationUserState');

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
    password,
  });
};

const createGroup = (owner, memberIds = []) => request(app)
  .post('/api/group/create')
  .set('Authorization', `Bearer ${tokenFor(owner)}`)
  .send({ title: 'Test Group', people: memberIds.map((id) => id.toString()) });

const deleteConversation = (user, conversationId) => request(app)
  .post('/api/conversation/delete')
  .set('Authorization', `Bearer ${tokenFor(user)}`)
  .send({ conversationId });

const restoreConversation = (user, conversationId) => request(app)
  .post('/api/conversation/restore')
  .set('Authorization', `Bearer ${tokenFor(user)}`)
  .send({ conversationId });

const listRemoved = (user) => request(app)
  .post('/api/conversations/removed')
  .set('Authorization', `Bearer ${tokenFor(user)}`)
  .send({});

const listRooms = (user) => request(app)
  .post('/api/rooms/list')
  .set('Authorization', `Bearer ${tokenFor(user)}`)
  .send({});

describe('Removed-conversations list (GET the ones I deleted from my own inbox)', () => {
  it('a deleted group appears in the removed list, not the normal inbox', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteConversation(member, group.body._id);

    const removed = await listRemoved(member);
    expect(removed.body.rooms.map((r) => r._id)).toContain(group.body._id);

    const normal = await listRooms(member);
    expect(normal.body.rooms.map((r) => r._id)).not.toContain(group.body._id);
  });

  it('the removed list is empty for a conversation the user never deleted', async () => {
    const owner = await createUser();
    const member = await createUser();
    await createGroup(owner, [member._id]);

    const removed = await listRemoved(member);
    expect(removed.body.rooms).toHaveLength(0);
  });
});

describe('Restoring a removed conversation', () => {
  it('conversation/restore clears deletedAt and moves the group back to the normal inbox', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteConversation(member, group.body._id);

    const res = await restoreConversation(member, group.body._id);
    expect(res.status).toBe(200);

    const normal = await listRooms(member);
    expect(normal.body.rooms.map((r) => r._id)).toContain(group.body._id);

    const removed = await listRemoved(member);
    expect(removed.body.rooms.map((r) => r._id)).not.toContain(group.body._id);
  });

  it('restore is idempotent — restoring twice does not error', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteConversation(member, group.body._id);

    const first = await restoreConversation(member, group.body._id);
    const second = await restoreConversation(member, group.body._id);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('a non-member cannot restore a conversation they are not part of', async () => {
    const owner = await createUser();
    const member = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteConversation(member, group.body._id);

    const res = await restoreConversation(stranger, group.body._id);
    expect(res.status).toBe(403);
  });

  it('restore fails for a group the owner has fully deleted (disabledAt) — restoring a hidden entry must not resurrect an actually-gone group', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteConversation(member, group.body._id);
    await request(app)
      .post('/api/group/delete')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id });

    const res = await restoreConversation(member, group.body._id);
    expect(res.status).toBe(404);
  });
});

// The actual reported scenario: a 2-person group where BOTH members delete
// the conversation from their own inbox. Neither list-rooms.js nor any
// group route ever gated on ConversationUserState.deletedAt (only on
// Room.disabledAt, a completely separate owner-deletes-the-group concept),
// so the group itself, both memberships, and every message were always
// intact underneath — the only real gap was that neither user had any UI
// to find their way back to it without a saved URL or invite link. This is
// exactly what the removed-list + restore routes close.
describe('Two-member group where both members delete it — recoverable, not lost', () => {
  it('the group is untouched at the data level and both members can independently restore it', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const group = await createGroup(userA, [userB._id]);
    const groupId = group.body._id;

    await deleteConversation(userA, groupId);
    await deleteConversation(userB, groupId);

    // Neither sees it in their normal inbox anymore.
    expect((await listRooms(userA)).body.rooms.map((r) => r._id)).not.toContain(groupId);
    expect((await listRooms(userB)).body.rooms.map((r) => r._id)).not.toContain(groupId);

    // The Room document itself is completely intact — never disabled.
    const room = await Room.findById(groupId);
    expect(room.disabledAt).toBeNull();

    // Both see it in their own removed list and can restore independently.
    expect((await listRemoved(userA)).body.rooms.map((r) => r._id)).toContain(groupId);
    expect((await listRemoved(userB)).body.rooms.map((r) => r._id)).toContain(groupId);

    await restoreConversation(userA, groupId);
    expect((await listRooms(userA)).body.rooms.map((r) => r._id)).toContain(groupId);
    // B restoring is independent of A — B's own tombstone is untouched by A's restore.
    expect((await listRooms(userB)).body.rooms.map((r) => r._id)).not.toContain(groupId);

    await restoreConversation(userB, groupId);
    expect((await listRooms(userB)).body.rooms.map((r) => r._id)).toContain(groupId);
  });

  it('a new message from either member also still restores it for everyone, independent of the explicit restore route', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const group = await createGroup(userA, [userB._id]);
    const groupId = group.body._id;

    await deleteConversation(userA, groupId);
    await deleteConversation(userB, groupId);

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(userA)}`)
      .field('roomID', groupId)
      .field('content', 'hello again')
      .field('type', 'text');

    const stateA = await ConversationUserState.findOne({ conversation: groupId, user: userA._id });
    const stateB = await ConversationUserState.findOne({ conversation: groupId, user: userB._id });
    expect(stateA.deletedAt).toBeNull();
    expect(stateB.deletedAt).toBeNull();
  });
});
