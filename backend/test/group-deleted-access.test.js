const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');

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

const deleteGroup = (owner, groupId) => request(app)
  .post('/api/group/delete')
  .set('Authorization', `Bearer ${tokenFor(owner)}`)
  .send({ id: groupId });

const send = (user, roomID, content) => request(app)
  .post('/api/message')
  .set('Authorization', `Bearer ${tokenFor(user)}`)
  .field('roomID', roomID)
  .field('content', content)
  .field('type', 'text');

// Reproduces a reported bug: after the OWNER deletes a group, a remaining
// member could still send messages into it — message.js never checked
// room.disabledAt (every other group route already did). The same gap
// existed across get-room/join-room/message-delete/message-read/
// more-messages/sync-messages/media/meeting-call — all fixed together
// since they share the exact same missing condition. See DECISIONS.md.
describe('A deleted group is fully inaccessible, not just to the owner', () => {
  it('rejects a message send from a remaining member after the group is deleted', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    const del = await deleteGroup(owner, group.body._id);
    expect(del.status).toBe(200);

    const res = await send(member, group.body._id, 'still trying to chat');
    expect(res.status).toBe(404);
  });

  it('rejects opening a deleted group via room/get', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteGroup(owner, group.body._id);

    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(404);
  });

  it('rejects joining/reopening a deleted group via room/join', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteGroup(owner, group.body._id);

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(404);
  });

  it('rejects fetching group details after deletion', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteGroup(owner, group.body._id);

    const res = await request(app)
      .post('/api/group/get')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(404);
  });
});

// A deleted group is permanently unopenable (every check above), but
// list-rooms.js never filters on disabledAt (by design — a deleted group
// stays visible until the user explicitly removes it, same as any other
// conversation, see list-rooms.js's own comment). Without a working
// conversation/delete path, that row would sit in the inbox forever,
// leading nowhere on every click, with no way to dismiss it.
describe('A deleted group can still be removed from the inbox (conversation/delete is not gated on disabledAt)', () => {
  it('the group still appears in list-rooms after deletion (it is not auto-hidden)', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteGroup(owner, group.body._id);

    const list = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({});
    expect(list.body.rooms.map((r) => r._id)).toContain(group.body._id);
  });

  it('a member can remove a deleted group from their own inbox via conversation/delete', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    await deleteGroup(owner, group.body._id);

    const del = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ conversationId: group.body._id });
    expect(del.status).toBe(200);

    const list = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({});
    expect(list.body.rooms.map((r) => r._id)).not.toContain(group.body._id);
  });

  it('the owner can also remove the group they just deleted from their own inbox', async () => {
    const owner = await createUser();
    const group = await createGroup(owner, []);
    await deleteGroup(owner, group.body._id);

    const del = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ conversationId: group.body._id });
    expect(del.status).toBe(200);

    const list = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({});
    expect(list.body.rooms.map((r) => r._id)).not.toContain(group.body._id);
  });
});
