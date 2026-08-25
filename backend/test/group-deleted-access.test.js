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
