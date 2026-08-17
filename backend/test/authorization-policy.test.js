const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Relationship = require('../src/models/Relationship');
const { authorizeAction, Actions, Decisions } = require('../src/authorization/policy');

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

describe('Messaging-first: strangers can start a DM and message without friendship', () => {
  it('a stranger (no relationship at all) can start a DM', async () => {
    const me = await createUser();
    const stranger = await createUser();

    const res = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', stranger._id.toString());

    expect(res.status).toBe(200);
    expect(res.body.room.people.map((p) => p._id?.toString?.() || p.toString())).toEqual(
      expect.arrayContaining([me._id.toString(), stranger._id.toString()]),
    );
  });

  it('reuses an existing DM instead of creating a duplicate', async () => {
    const me = await createUser();
    const stranger = await createUser();

    const first = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', stranger._id.toString());
    const second = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', stranger._id.toString());

    expect(first.body.room._id).toBe(second.body.room._id);
    const count = await Room.countDocuments({ isGroup: false, people: { $all: [me._id, stranger._id] } });
    expect(count).toBe(1);
  });

  it('a stranger can send the first message with no prior relationship', async () => {
    const me = await createUser();
    const stranger = await createUser();
    const room = await Room.create({ people: [me._id, stranger._id], isGroup: false });

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .field('roomID', room._id.toString())
      .field('content', 'hi, we have never talked before')
      .field('type', 'text');

    expect(res.status).toBe(200);
  });

  it('a stranger can send a friend request with no prior relationship', async () => {
    const me = await createUser();
    const stranger = await createUser({ username: 'AStranger' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(stranger)}`)
      .field('username', me.username);

    expect(res.status).toBe(200);
  });
});

describe('Blocking overrides every other relationship state', () => {
  it('a blocked user cannot start a new DM with the blocker', async () => {
    const blocker = await createUser({ username: 'Blocker' });
    const blocked = await createUser({ username: 'Blocked' });

    await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(blocker)}`)
      .field('username', blocked.username);

    const res = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(blocked)}`)
      .field('counterpart', blocker._id.toString());

    expect(res.status).toBe(403);
  });

  it('a blocked user cannot message the blocker even in an existing DM', async () => {
    const blocker = await createUser({ username: 'Blocker2' });
    const blocked = await createUser({ username: 'Blocked2' });
    const room = await Room.create({ people: [blocker._id, blocked._id], isGroup: false });

    await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(blocker)}`)
      .field('username', blocked.username);

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(blocked)}`)
      .field('roomID', room._id.toString())
      .field('content', 'still trying to talk')
      .field('type', 'text');

    expect(res.status).toBe(403);
  });

  it('blocking overrides a previously ACCEPTED relationship', async () => {
    const blocker = await createUser({ username: 'WasFriendA' });
    const blocked = await createUser({ username: 'WasFriendB' });
    await Relationship.create({ requester: blocker._id, recipient: blocked._id, status: 'accepted' });

    await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(blocker)}`)
      .field('username', blocked.username);

    const decision = await authorizeAction({ actor: blocked._id, target: blocker._id, action: Actions.SEND_MESSAGE });
    expect(decision.decision).toBe(Decisions.DENY);
    expect(decision.reason).toBe('blocked');
  });

  it('a blocked user cannot send a new friend request to the blocker', async () => {
    const blocker = await createUser({ username: 'BlockerC' });
    const blocked = await createUser({ username: 'BlockedC' });

    await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(blocker)}`)
      .field('username', blocked.username);

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(blocked)}`)
      .field('username', blocker.username);

    expect(res.status).toBe(403);
  });

  it('unblock removes the block and a fresh DM can be started again', async () => {
    const blocker = await createUser({ username: 'UnblockA' });
    const other = await createUser({ username: 'UnblockB' });

    await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(blocker)}`)
      .field('username', other.username);

    const stillBlocked = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .field('counterpart', blocker._id.toString());
    expect(stillBlocked.status).toBe(403);

    await request(app)
      .post('/api/unblock')
      .set('Authorization', `Bearer ${tokenFor(blocker)}`)
      .field('username', other.username);

    const afterUnblock = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(other)}`)
      .field('counterpart', blocker._id.toString());
    expect(afterUnblock.status).toBe(200);
  });

  it('only the blocker can unblock (target cannot unblock themselves)', async () => {
    const blocker = await createUser({ username: 'OnlyBlockerA' });
    const blocked = await createUser({ username: 'OnlyBlockerB' });

    await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(blocker)}`)
      .field('username', blocked.username);

    const res = await request(app)
      .post('/api/unblock')
      .set('Authorization', `Bearer ${tokenFor(blocked)}`)
      .field('username', blocker.username);

    expect(res.status).toBe(404);
  });
});

describe('Conversation membership is independent of relationship state', () => {
  it('a group message succeeds even though one member has blocked another (block does not reach into groups)', async () => {
    const a = await createUser({ username: 'GroupA' });
    const b = await createUser({ username: 'GroupB' });
    const c = await createUser({ username: 'GroupC' });
    const room = await Room.create({ people: [a._id, b._id, c._id], isGroup: true, title: 'Group' });

    await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(a)}`)
      .field('username', b.username);

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .field('roomID', room._id.toString())
      .field('content', 'group message despite 1:1 block')
      .field('type', 'text');

    expect(res.status).toBe(200);
  });

  it('a non-member still cannot access a conversation regardless of relationship', async () => {
    const owner = await createUser({ username: 'OwnerX' });
    const friend = await createUser({ username: 'FriendX' });
    await Relationship.create({ requester: owner._id, recipient: friend._id, status: 'accepted' });
    const room = await Room.create({ people: [owner._id], isGroup: false });

    const res = await request(app)
      .post('/api/message')
      .set('Authorization', `Bearer ${tokenFor(friend)}`)
      .field('roomID', room._id.toString())
      .field('content', 'trying to join a room I am not in')
      .field('type', 'text');

    expect(res.status).toBe(403);
  });
});

describe('Self-targeting is denied uniformly', () => {
  it('cannot start a conversation with yourself', async () => {
    const me = await createUser();
    const res = await request(app)
      .post('/api/room/create')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('counterpart', me._id.toString());

    expect(res.status).toBe(403);
  });

  it('cannot block yourself', async () => {
    const me = await createUser({ username: 'SelfBlock' });
    const res = await request(app)
      .post('/api/block')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', me.username);

    expect(res.status).toBe(400);
  });
});

describe('authorizeAction() unit behavior', () => {
  it('denies with unauthenticated when actor is missing', async () => {
    const decision = await authorizeAction({ actor: null, target: 'someid', action: Actions.SEND_MESSAGE });
    expect(decision.decision).toBe(Decisions.DENY);
    expect(decision.reason).toBe('unauthenticated');
  });

  it('allows when there is no target (action with no target concept)', async () => {
    const me = await createUser();
    const decision = await authorizeAction({ actor: me._id, target: null, action: Actions.SEND_MESSAGE });
    expect(decision.decision).toBe(Decisions.ALLOW);
  });
});
