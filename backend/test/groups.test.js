const request = require('supertest');
const argon2 = require('argon2');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const GroupMember = require('../src/models/GroupMember');
const Message = require('../src/models/Message');

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

// Real production traffic (frontend/src/actions/createGroup.js) posts a JSON
// body via axios, not multipart form fields — .send() matches that, and
// unlike .field() correctly preserves `people` as a real array (see
// admin-boundary.test.js's own group-creation tests for the same pattern).
const createGroup = (owner, memberIds = []) => request(app)
  .post('/api/group/create')
  .set('Authorization', `Bearer ${tokenFor(owner)}`)
  .send({ title: 'Test Group', people: memberIds.map((id) => id.toString()) });

describe('Group creation', () => {
  it('creates a Room+GroupMember(OWNER) for the creator', async () => {
    const owner = await createUser();
    const res = await createGroup(owner);

    expect(res.status).toBe(200);
    expect(res.body.myRole).toBe('OWNER');

    const room = await Room.findOne({ _id: res.body._id });
    expect(room.isGroup).toBe(true);
    expect(room.ownerId.toString()).toBe(owner._id.toString());

    const membership = await GroupMember.findOne({ group: room._id, user: owner._id });
    expect(membership.role).toBe('OWNER');
  });

  it('invited people become MEMBER', async () => {
    const owner = await createUser();
    const member = await createUser();
    const res = await createGroup(owner, [member._id]);

    const membership = await GroupMember.findOne({ group: res.body._id, user: member._id });
    expect(membership.role).toBe('MEMBER');
  });

  it('creates memberships for every invited person, not just one', async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const res = await createGroup(owner, [a._id, b._id, c._id]);

    const count = await GroupMember.countDocuments({ group: res.body._id });
    expect(count).toBe(4); // owner + 3 invitees
  });

  it('rejects a group referencing a nonexistent member id', async () => {
    const owner = await createUser();
    const res = await createGroup(owner, [new mongoose.Types.ObjectId()]);
    expect(res.status).toBe(400);
  });
});

describe('Membership authorization', () => {
  it('a non-member gets a 404 on group details, members, and message send', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const created = await createGroup(owner);
    const groupId = created.body._id;

    const getRes = await request(app).post('/api/group/get')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`).send({ id: groupId });
    expect(getRes.status).toBe(404);

    const membersRes = await request(app).post('/api/group/members')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`).send({ id: groupId });
    expect(membersRes.status).toBe(404);

    const msgRes = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ roomID: groupId, content: 'hi', type: 'text' });
    expect(msgRes.status).toBe(403);
  });

  it('a member can read group details and send messages', async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [member._id]);

    const getRes = await request(app).post('/api/group/get')
      .set('Authorization', `Bearer ${tokenFor(member)}`).send({ id: created.body._id });
    expect(getRes.status).toBe(200);
    expect(getRes.body.group.myRole).toBe('MEMBER');

    const msgRes = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ roomID: created.body._id, content: 'hi', type: 'text' });
    expect(msgRes.status).toBe(200);
  });
});

describe('IDOR', () => {
  it('guessing a groupId you are not a member of behaves like it does not exist', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const created = await createGroup(owner);

    const res = await request(app).post('/api/group/get')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`).send({ id: created.body._id });
    expect(res.status).toBe(404);
  });

  it('a stale groupId after removal fails identically to a nonexistent group', async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [member._id]);
    const groupId = created.body._id;

    await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, userId: member._id.toString() });

    const res = await request(app).post('/api/group/get')
      .set('Authorization', `Bearer ${tokenFor(member)}`).send({ id: groupId });
    expect(res.status).toBe(404);

    const msgRes = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ roomID: groupId, content: 'hi', type: 'text' });
    expect(msgRes.status).toBe(403);
  });
});

describe('Role hierarchy / privilege escalation prevention', () => {
  const setupGroup = async () => {
    const owner = await createUser();
    const admin = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [admin._id, member._id]);
    const groupId = created.body._id;
    await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: admin._id.toString(), role: 'ADMIN' });
    return {
      owner, admin, member, groupId,
    };
  };

  it('MEMBER cannot promote themselves to ADMIN', async () => {
    const { member, groupId } = await setupGroup();
    const res = await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('ADMIN cannot promote anyone to OWNER', async () => {
    const { admin, member, groupId } = await setupGroup();
    const res = await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'OWNER' });
    expect(res.status).toBe(400);
  });

  it('ADMIN cannot demote/promote another ADMIN (MANAGE_ADMINS is OWNER-only)', async () => {
    const {
      owner, admin, member, groupId,
    } = await setupGroup();
    // second admin
    await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'ADMIN' });

    const res = await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'MEMBER' });
    expect(res.status).toBe(403);
  });

  it('ADMIN cannot remove another ADMIN or the OWNER', async () => {
    const {
      owner, admin, member, groupId,
    } = await setupGroup();
    await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'ADMIN' });

    const removeOtherAdmin = await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ id: groupId, userId: member._id.toString() });
    expect(removeOtherAdmin.status).toBe(403);

    const removeOwner = await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ id: groupId, userId: owner._id.toString() });
    expect(removeOwner.status).toBe(403);
  });

  it('ADMIN can remove a plain MEMBER', async () => {
    const { admin, member, groupId } = await setupGroup();
    const res = await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ id: groupId, userId: member._id.toString() });
    expect(res.status).toBe(200);
  });

  it('a non-member cannot change anyone\'s role', async () => {
    const { member, groupId } = await setupGroup();
    const outsider = await createUser();
    const res = await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'ADMIN' });
    expect(res.status).toBe(404);
  });

  it('OWNER can promote MEMBER to ADMIN and back', async () => {
    const { owner, member, groupId } = await setupGroup();
    const promote = await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'ADMIN' });
    expect(promote.status).toBe(200);

    const demote = await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: member._id.toString(), role: 'MEMBER' });
    expect(demote.status).toBe(200);
  });
});

describe('Member add/remove concurrency', () => {
  it('re-adding an already-active member is an idempotent no-op, not a duplicate', async () => {
    const owner = await createUser();
    const target = await createUser();
    const created = await createGroup(owner);
    const groupId = created.body._id;

    const first = await request(app).post('/api/group/members/add')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, userId: target._id.toString() });
    const second = await request(app).post('/api/group/members/add')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, userId: target._id.toString() });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const count = await GroupMember.countDocuments({ group: groupId, user: target._id });
    expect(count).toBe(1);
  });

  it('concurrent add requests for the same user only create one active membership', async () => {
    const owner = await createUser();
    const target = await createUser();
    const created = await createGroup(owner);
    const groupId = created.body._id;

    const [r1, r2] = await Promise.all([
      request(app).post('/api/group/members/add')
        .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, userId: target._id.toString() }),
      request(app).post('/api/group/members/add')
        .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, userId: target._id.toString() }),
    ]);

    expect([r1.status, r2.status]).toEqual([200, 200]);
    const count = await GroupMember.countDocuments({ group: groupId, user: target._id });
    expect(count).toBe(1);
  });

  it('re-adding a previously-removed member re-activates rather than erroring', async () => {
    const owner = await createUser();
    const target = await createUser();
    const created = await createGroup(owner, [target._id]);
    const groupId = created.body._id;

    await request(app).post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, userId: target._id.toString() });

    const readd = await request(app).post('/api/group/members/add')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, userId: target._id.toString() });
    expect(readd.status).toBe(200);

    const membership = await GroupMember.findOne({ group: groupId, user: target._id });
    expect(membership.active).toBe(true);
  });
});

describe('Admin privacy boundary inside groups', () => {
  it('a standard user cannot add a privileged user to a group', async () => {
    const owner = await createUser();
    const admin = await createAdmin();
    const created = await createGroup(owner);

    const res = await request(app).post('/api/group/members/add')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: created.body._id, userId: admin._id.toString() });
    expect(res.status).toBe(404);

    const membership = await GroupMember.findOne({ group: created.body._id, user: admin._id });
    expect(membership).toBeNull();
  });

  it('an admin who is already a legitimate group member stays visible to co-members', async () => {
    const admin = await createAdmin();
    const member = await createUser();
    // Admin creates the group and adds a standard member directly — groups
    // are exempt from the DM boundary at creation time (see create-group.js).
    const created = await createGroup(admin, [member._id]);
    const groupId = created.body._id;

    const membersRes = await request(app).post('/api/group/members')
      .set('Authorization', `Bearer ${tokenFor(member)}`).send({ id: groupId });
    expect(membersRes.status).toBe(200);
    const found = membersRes.body.members.find((m) => m.user._id === admin._id.toString());
    expect(found).toBeDefined();
  });
});

describe('Message authorization in groups', () => {
  it('never trusts a client-supplied author field', async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [member._id]);

    const res = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({
        roomID: created.body._id, content: 'hi', type: 'text', author: owner._id.toString(),
      });

    expect(res.status).toBe(200);
    const message = await Message.findById(res.body.message._id);
    expect(message.author.toString()).toBe(member._id.toString());
  });

  it('rejects a message from a non-member', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const created = await createGroup(owner);

    const res = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({ roomID: created.body._id, content: 'hi', type: 'text' });
    expect(res.status).toBe(403);
  });

  it('an ADMIN can delete-for-everyone a message they did not author (DELETE_MESSAGE capability)', async () => {
    const owner = await createUser();
    const admin = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [admin._id, member._id]);
    const groupId = created.body._id;
    await request(app).post('/api/group/members/role')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, userId: admin._id.toString(), role: 'ADMIN' });

    const sendRes = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ roomID: groupId, content: 'hi', type: 'text' });
    const messageID = sendRes.body.message._id;

    const delRes = await request(app).post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ roomID: groupId, messageID, forEveryone: true });
    expect(delRes.status).toBe(200);
  });

  it('a plain MEMBER cannot delete-for-everyone another member\'s message', async () => {
    const owner = await createUser();
    const memberA = await createUser();
    const memberB = await createUser();
    const created = await createGroup(owner, [memberA._id, memberB._id]);
    const groupId = created.body._id;

    const sendRes = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(memberA)}`)
      .send({ roomID: groupId, content: 'hi', type: 'text' });
    const messageID = sendRes.body.message._id;

    const delRes = await request(app).post('/api/message/delete')
      .set('Authorization', `Bearer ${tokenFor(memberB)}`)
      .send({ roomID: groupId, messageID, forEveryone: true });
    expect(delRes.status).toBe(403);
  });
});

describe('Blocked-user restrictions do not apply inside groups', () => {
  it('two blocked users can still both be group members and message', async () => {
    const owner = await createUser();
    const userA = await createUser();
    const userB = await createUser();
    await request(app).post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(userA)}`).send({ username: userB.username });

    const created = await createGroup(owner, [userA._id, userB._id]);
    const groupId = created.body._id;

    const res = await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(userB)}`)
      .send({ roomID: groupId, content: 'hi', type: 'text' });
    expect(res.status).toBe(200);
  });
});

describe('Group deletion lifecycle', () => {
  it('a non-owner cannot delete the group', async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [member._id]);

    const res = await request(app).post('/api/group/delete')
      .set('Authorization', `Bearer ${tokenFor(member)}`).send({ id: created.body._id });
    expect(res.status).toBe(403);
  });

  it('owner delete marks the group disabled and revokes access for everyone', async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [member._id]);
    const groupId = created.body._id;

    const res = await request(app).post('/api/group/delete')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId });
    expect(res.status).toBe(200);

    const room = await Room.findById(groupId);
    expect(room.disabledAt).not.toBeNull();

    const ownerGet = await request(app).post('/api/group/get')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId });
    expect(ownerGet.status).toBe(404);

    const memberGet = await request(app).post('/api/group/get')
      .set('Authorization', `Bearer ${tokenFor(member)}`).send({ id: groupId });
    expect(memberGet.status).toBe(404);
  });

  it('a non-owner "remove room" on a group leaves it without deleting messages for everyone', async () => {
    const owner = await createUser();
    const member = await createUser();
    const created = await createGroup(owner, [member._id]);
    const groupId = created.body._id;

    await request(app).post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ roomID: groupId, content: 'hi', type: 'text' });

    const res = await request(app).post('/api/room/remove')
      .set('Authorization', `Bearer ${tokenFor(member)}`).send({ id: groupId });
    expect(res.status).toBe(200);

    const room = await Room.findById(groupId);
    expect(room).not.toBeNull(); // group still exists for the owner
    const messageCount = await Message.countDocuments({ room: groupId });
    expect(messageCount).toBe(1); // messages untouched

    const membership = await GroupMember.findOne({ group: groupId, user: member._id });
    expect(membership.active).toBe(false);
  });

  it('the owner cannot use "remove room" to delete a group — must use the delete endpoint', async () => {
    const owner = await createUser();
    const created = await createGroup(owner);

    const res = await request(app).post('/api/room/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: created.body._id });
    expect(res.status).toBe(400);

    const room = await Room.findById(created.body._id);
    expect(room).not.toBeNull();
  });
});

describe('Cursor pagination / member list limits', () => {
  it('clamps an oversized limit and paginates without duplicates or gaps', async () => {
    const owner = await createUser();
    const members = await Promise.all(Array.from({ length: 12 }, () => createUser()));
    const created = await createGroup(owner, members.map((m) => m._id));
    const groupId = created.body._id;

    const page1 = await request(app).post('/api/group/members')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, limit: 5 });
    expect(page1.status).toBe(200);
    expect(page1.body.members.length).toBe(5);
    expect(page1.body.cursor).toBeTruthy();

    const page2 = await request(app).post('/api/group/members')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: groupId, limit: 5, cursor: page1.body.cursor });
    expect(page2.body.members.length).toBe(5);

    const ids1 = page1.body.members.map((m) => m._id);
    const ids2 = page2.body.members.map((m) => m._id);
    expect(ids1.filter((id) => ids2.includes(id)).length).toBe(0); // no overlap

    const requestedTooMany = await request(app).post('/api/group/members')
      .set('Authorization', `Bearer ${tokenFor(owner)}`).send({ id: groupId, limit: 99999 });
    expect(requestedTooMany.body.limit).toBeLessThanOrEqual(100);
  });
});
