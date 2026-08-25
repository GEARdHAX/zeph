const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Message = require('../src/models/Message');
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

// A removed/banned user needs to know WHO did it and WHY (removed vs
// banned) to render an accurate in-app notice — the previous
// forceLeaveGroupRoom() only ever emitted {groupId, userId, self:true},
// indistinguishable from a self-leave and with no actor name. See
// DECISIONS.md.
describe('The removed/banned user is told who did it and why', () => {
  let toSpyCalls;
  let fakeSocket;
  let fakeSocketUserId;

  // forceLeaveGroupRoom.js only reaches CONNECTED sockets
  // (store.socketsByUserID[userId] || []) — a test user with no live
  // connection never receives the emit at all, which is real, correct
  // behavior (nothing to notify), but means this suite must register a
  // fake connected socket for the target to observe what would be sent.
  const connectSocket = (userId) => {
    fakeSocketUserId = userId.toString();
    fakeSocket = {
      leave: () => {},
      emit: (event, payload) => toSpyCalls.push({ target: fakeSocketUserId, event, payload }),
    };
    store.socketsByUserID[fakeSocketUserId] = [fakeSocket];
  };

  beforeEach(() => {
    toSpyCalls = [];
    store.io = {
      to: (target) => ({
        emit: (event, payload) => toSpyCalls.push({ target, event, payload }),
      }),
      emit: () => {},
    };
  });

  afterEach(() => {
    if (fakeSocketUserId) delete store.socketsByUserID[fakeSocketUserId];
    fakeSocketUserId = null;
  });

  afterAll(() => {
    store.io = { to: () => ({ emit: () => {} }), emit: () => {} };
  });

  it('remove sends the target a reason:"removed" event carrying the actor name and group name', async () => {
    const owner = await createUser({ firstName: 'Alice', lastName: 'Owner', username: 'aliceowner' });
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);
    connectSocket(target._id);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const targetEvent = toSpyCalls.find((c) => c.target === target._id.toString() && c.event === 'group:member:removed');
    expect(targetEvent).toBeDefined();
    expect(targetEvent.payload.reason).toBe('removed');
    expect(targetEvent.payload.actorName).toBe('Alice Owner');
    expect(targetEvent.payload.groupName).toBe('Test Group');
    expect(targetEvent.payload.self).toBe(true);
  });

  it('ban sends the target a reason:"banned" event, distinguishable from a plain removal', async () => {
    const owner = await createUser({ firstName: 'Bob', lastName: 'Owner', username: 'bobowner' });
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);
    connectSocket(target._id);

    await request(app)
      .post('/api/group/members/ban')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id, userId: target._id });

    const targetEvent = toSpyCalls.find((c) => c.target === target._id.toString() && c.event === 'group:member:removed');
    expect(targetEvent).toBeDefined();
    expect(targetEvent.payload.reason).toBe('banned');
    expect(targetEvent.payload.actorName).toBe('Bob Owner');
  });

  it('self-leave sends reason:"left", not "removed"', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);
    connectSocket(member._id);

    await request(app)
      .post('/api/group/leave')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: group.body._id });

    const targetEvent = toSpyCalls.find((c) => c.target === member._id.toString() && c.event === 'group:member:removed');
    expect(targetEvent).toBeDefined();
    expect(targetEvent.payload.reason).toBe('left');
  });
});

// A removed/banned user is no longer in Room.people, so the plain
// isMember check in conversation-delete.js used to 403 them — leaving the
// now-inaccessible group stuck in their inbox forever with no way to
// remove it. groupPolicy.wasEverMember() closes that gap.
describe('A removed/banned former member can still delete the group from their own inbox', () => {
  it('a removed member can call conversation/delete on the group', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ conversationId: group.body._id });
    expect(res.status).toBe(200);
  });

  it('a banned member can still call conversation/delete on the group', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/ban')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ conversationId: group.body._id });
    expect(res.status).toBe(200);
  });

  it('a total stranger (never a member) still gets 403', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner);

    const res = await request(app)
      .post('/api/conversation/delete')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .send({ conversationId: group.body._id });
    expect(res.status).toBe(403);
  });
});

// The remaining group members need an inline, persisted chat entry
// announcing the removal/ban — not just a live socket toast, which only
// reaches whoever's online at that exact moment. Reuses the Message model
// (type:'system', no author) so it survives reload/pagination and shows up
// in the sidebar's last-message preview like a real message. See
// postSystemMessage.js / DECISIONS.md.
describe('Remaining members see an inline system message for a removal/ban', () => {
  let toSpyCalls;

  beforeEach(() => {
    toSpyCalls = [];
    store.io = {
      to: (target) => ({
        emit: (event, payload) => toSpyCalls.push({ target, event, payload }),
      }),
      emit: () => {},
    };
  });

  afterAll(() => {
    store.io = { to: () => ({ emit: () => {} }), emit: () => {} };
  });

  it('persists a type:system message with the target and actor names on remove', async () => {
    const owner = await createUser({ firstName: 'Alice', lastName: 'Owner', username: 'aliceowner2' });
    const target = await createUser({ firstName: 'Tom', lastName: 'Target', username: 'tomtarget' });
    const bystander = await createUser();
    const group = await createGroup(owner, [target._id, bystander._id]);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const systemMessage = await Message.findOne({ room: group.body._id, type: 'system' });
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toBe('Tom Target was removed by Alice Owner');
    expect(systemMessage.author).toBeFalsy();
  });

  it('persists a type:system message distinguishing "banned" from "removed"', async () => {
    const owner = await createUser({ firstName: 'Bob', lastName: 'Owner', username: 'bobowner2' });
    const target = await createUser({ firstName: 'Jane', lastName: 'Bad', username: 'janebad' });
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/ban')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id, userId: target._id });

    const systemMessage = await Message.findOne({ room: group.body._id, type: 'system' });
    expect(systemMessage.content).toBe('Jane Bad was banned by Bob Owner');
  });

  it('delivers the system message to remaining members via message-in, but not to the removed user', async () => {
    const owner = await createUser({ firstName: 'Alice', lastName: 'Owner', username: 'aliceowner3' });
    const target = await createUser();
    const bystander = await createUser();
    const group = await createGroup(owner, [target._id, bystander._id]);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const systemMessageEvents = toSpyCalls.filter((c) => c.event === 'message-in' && c.payload.message.type === 'system');
    const recipientTargets = systemMessageEvents.map((c) => c.target);
    expect(recipientTargets).toEqual(expect.arrayContaining([owner._id.toString(), bystander._id.toString()]));
    expect(recipientTargets).not.toContain(target._id.toString());
  });
});

// After a refresh, the removed/banned user must still see the group in
// their inbox with existing history intact (read-only) — not have it
// vanish outright, which previously happened because list-rooms.js/
// get-room.js/more-messages.js/sync-messages.js all filtered strictly on
// current Room.people membership. See groupPolicy.canReadRoomHistory.
describe('A removed/banned former member keeps read access to group history', () => {
  it('the group still appears in list-rooms for a removed member', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/rooms/list')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.rooms.map((r) => r._id)).toContain(group.body._id);
  });

  it('room/get succeeds for a removed member and reports accessRevoked', async () => {
    const owner = await createUser({ firstName: 'Alice', lastName: 'Owner', username: 'aliceowner4' });
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.accessRevoked).toEqual({ reason: 'removed', actorName: 'Alice Owner' });
  });

  it('room/get reports accessRevoked reason:"banned" for a banned member', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/ban')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.accessRevoked.reason).toBe('banned');
  });

  it('a current member opening the room never gets accessRevoked', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.accessRevoked).toBeUndefined();
  });

  it('a total stranger (never a member) still gets 403 from room/get', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner);

    const res = await request(app)
      .post('/api/room/get')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(403);
  });

  it('a removed member can page through history via more-messages', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ roomID: group.body._id, content: 'hello before removal', type: 'text' });

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/messages/more')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ roomID: group.body._id, firstMessageID: 'ffffffffffffffffffffffff' });
    expect(res.status).toBe(200);
  });

  it('sending a message is still blocked for a removed member (read-only, not full access)', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ roomID: group.body._id, content: 'let me back in', type: 'text' });
    expect(res.status).toBe(403);
  });
});

// room/join (not room/get) is the endpoint the frontend's getRoom() action
// actually calls when opening a conversation — see frontend/src/actions/
// getRoom.js. A removed/banned member must get the same read-only access +
// accessRevoked reconstruction here, not just from room/get, or "Room Not
// Found" is exactly what a real opened-in-the-browser reproduction shows.
describe('room/join (the real room-open endpoint) for a removed/banned former member', () => {
  it('succeeds (not 404) and reports accessRevoked for a removed member', async () => {
    const owner = await createUser({ firstName: 'Alice', lastName: 'Owner', username: 'aliceownerjoin1' });
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.accessRevoked).toEqual({ reason: 'removed', actorName: 'Alice Owner' });
  });

  it('reports accessRevoked reason:"banned" for a banned member', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/group/members/ban')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ groupId: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.accessRevoked.reason).toBe('banned');
  });

  it('still returns the existing message history for a removed member', async () => {
    const owner = await createUser();
    const target = await createUser();
    const group = await createGroup(owner, [target._id]);

    await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ roomID: group.body._id, content: 'hello before removal', type: 'text' });

    await request(app)
      .post('/api/group/members/remove')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id });

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.messages.some((m) => m.content === 'hello before removal')).toBe(true);
  });

  it('a current member opening the room never gets accessRevoked', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member._id]);

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.accessRevoked).toBeUndefined();
  });

  it('a total stranger (never a member) still gets 404 from room/join', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner);

    const res = await request(app)
      .post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(404);
  });
});

// Matches the existing remove/ban/join system messages — a self-leave is
// just as much a membership change the remaining members should see
// inline, not just reflected silently in the member count.
describe('Self-leave posts an inline system message', () => {
  it('persists a type:system message naming the leaver', async () => {
    const owner = await createUser();
    const member = await createUser({ firstName: 'Leo', lastName: 'Leaver', username: 'leoleaver' });
    const group = await createGroup(owner, [member._id]);

    const res = await request(app)
      .post('/api/group/leave')
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);

    const systemMessage = await Message.findOne({ room: group.body._id, type: 'system' });
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toBe('Leo Leaver left the group');
  });

  it('does not post a leave message for the owner (who cannot use this endpoint)', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await request(app)
      .post('/api/group/leave')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(400);

    const systemMessage = await Message.findOne({ room: group.body._id, type: 'system' });
    expect(systemMessage).toBeNull();
  });
});

// "You joined via X, invited by Y" needs structured data (not scraped from
// the system message text, which can be hidden by a stale
// ConversationUserState.deletedBefore cutoff after delete-then-rejoin — see
// unhideConversationForUser.js) so the empty-state message stays accurate
// regardless of message-history visibility. See groupPolicy.getJoinInfo.
describe('room/join reports myJoinInfo (how the caller joined)', () => {
  it('reports joinedVia ADDED with the inviter name for a direct add', async () => {
    const owner = await createUser({ firstName: 'Alice', lastName: 'Owner', username: 'aliceownerjoin5' });
    const target = await createUser();
    const group = await createGroup(owner);

    await request(app).post('/api/group/members/add')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id, userId: target._id.toString() });

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(target)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.myJoinInfo).toEqual({ method: 'ADDED', inviterName: 'Alice Owner' });
  });

  it('reports joinedVia CREATED with no inviter for the group creator', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send({ id: group.body._id });
    expect(res.status).toBe(200);
    expect(res.body.room.myJoinInfo).toEqual({ method: 'CREATED', inviterName: null });
  });

  it('is absent for a 1:1 room', async () => {
    const a = await createUser();
    const b = await createUser();
    const Room = require('../src/models/Room');
    const room = await Room.create({ people: [a._id, b._id], isGroup: false });

    const res = await request(app).post('/api/room/join')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .send({ id: room._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.room.myJoinInfo).toBeUndefined();
  });
});
