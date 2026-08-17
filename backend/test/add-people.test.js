const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
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
    password,
    discoveryEnabled: overrides.discoveryEnabled,
  });
};

describe('Username uniqueness is case-insensitive', () => {
  it('derives usernameNormalized from username on save', async () => {
    const user = await createUser({ username: 'AliceInChains' });
    expect(user.usernameNormalized).toBe('aliceinchains');
  });

  it('rejects a second user whose username differs only by case', async () => {
    await createUser({ username: 'Bob' });
    await expect(createUser({ username: 'bob' })).rejects.toThrow();
  });
});

describe('GET /api/users/:username — profile resolution', () => {
  it('resolves a user by username regardless of case', async () => {
    const me = await createUser();
    const target = await createUser({ username: 'FindMe' });

    const res = await request(app)
      .get('/api/users/findme')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('FindMe');
    expect(res.body.user._id).toBe(target._id.toString());
  });

  it('never returns email or password', async () => {
    const me = await createUser();
    await createUser({ username: 'Private' });

    const res = await request(app)
      .get('/api/users/private')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.body.user.email).toBeUndefined();
    expect(res.body.user.password).toBeUndefined();
  });

  it('returns 404 for a nonexistent username', async () => {
    const me = await createUser();

    const res = await request(app)
      .get('/api/users/nobody-here')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 (not 403) for a user who has disabled discovery — indistinguishable from nonexistent', async () => {
    const me = await createUser();
    await createUser({ username: 'Hidden', discoveryEnabled: false });

    const res = await request(app)
      .get('/api/users/hidden')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated request', async () => {
    await createUser({ username: 'Someone' });
    const res = await request(app).get('/api/users/someone');
    expect(res.status).toBe(401);
  });

  it('reports existing relationship state and direction', async () => {
    const me = await createUser();
    const target = await createUser({ username: 'Pending' });
    const relationship = await Relationship.create({ requester: me._id, recipient: target._id, status: 'pending' });

    const res = await request(app)
      .get('/api/users/pending')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.body.relationship).toEqual({
      _id: relationship._id.toString(),
      status: 'pending',
      direction: 'outgoing',
    });
  });
});

describe('POST /api/friend-requests — send', () => {
  it('creates a pending request', async () => {
    const me = await createUser();
    const target = await createUser({ username: 'Target' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'target');

    expect(res.status).toBe(200);
    expect(res.body.relationship.status).toBe('pending');

    const stored = await Relationship.findOne({ requester: me._id, recipient: target._id });
    expect(stored).not.toBeNull();
  });

  it('rejects sending a request to yourself', async () => {
    const me = await createUser({ username: 'Solo' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'solo');

    expect(res.status).toBe(400);
  });

  it('rejects a duplicate request (already pending)', async () => {
    const me = await createUser();
    const target = await createUser({ username: 'AlreadyAsked' });
    await Relationship.create({ requester: me._id, recipient: target._id, status: 'pending' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'alreadyasked');

    expect(res.status).toBe(409);
  });

  it('rejects a request when the reverse relationship already exists', async () => {
    const me = await createUser();
    const target = await createUser({ username: 'ReverseCase' });
    await Relationship.create({ requester: target._id, recipient: me._id, status: 'pending' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'reversecase');

    expect(res.status).toBe(409);
  });

  it('returns 404 for a nonexistent target username', async () => {
    const me = await createUser();

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'ghost-user');

    expect(res.status).toBe(404);
  });

  it('returns 404 when the target has discovery disabled', async () => {
    const me = await createUser();
    await createUser({ username: 'NoDiscover', discoveryEnabled: false });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'nodiscover');

    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/friend-requests').field('username', 'someone');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/friend-requests/:id/accept and /decline — IDOR + state machine', () => {
  it('allows the recipient to accept a pending request', async () => {
    const requester = await createUser();
    const recipient = await createUser();
    const relationship = await Relationship.create({ requester: requester._id, recipient: recipient._id });

    const res = await request(app)
      .post(`/api/friend-requests/${relationship._id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(200);
    expect(res.body.relationship.status).toBe('accepted');
  });

  it('blocks the requester from accepting their own outgoing request (IDOR)', async () => {
    const requester = await createUser();
    const recipient = await createUser();
    const relationship = await Relationship.create({ requester: requester._id, recipient: recipient._id });

    const res = await request(app)
      .post(`/api/friend-requests/${relationship._id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(requester)}`);

    expect(res.status).toBe(404);
    const unchanged = await Relationship.findById(relationship._id);
    expect(unchanged.status).toBe('pending');
  });

  it('blocks an unrelated third party from accepting a request addressed to someone else (IDOR)', async () => {
    const requester = await createUser();
    const recipient = await createUser();
    const attacker = await createUser();
    const relationship = await Relationship.create({ requester: requester._id, recipient: recipient._id });

    const res = await request(app)
      .post(`/api/friend-requests/${relationship._id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(attacker)}`);

    expect(res.status).toBe(404);
  });

  it('allows the recipient to decline a pending request', async () => {
    const requester = await createUser();
    const recipient = await createUser();
    const relationship = await Relationship.create({ requester: requester._id, recipient: recipient._id });

    const res = await request(app)
      .post(`/api/friend-requests/${relationship._id}/decline`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(200);
    expect(res.body.relationship.status).toBe('declined');
  });

  it('rejects accepting an already-accepted request (no double-accept)', async () => {
    const requester = await createUser();
    const recipient = await createUser();
    const relationship = await Relationship.create({
      requester: requester._id,
      recipient: recipient._id,
      status: 'accepted',
      respondedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/friend-requests/${relationship._id}/accept`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for a nonexistent relationship id', async () => {
    const recipient = await createUser();
    const fakeId = '507f1f77bcf86cd799439011';

    const res = await request(app)
      .post(`/api/friend-requests/${fakeId}/accept`)
      .set('Authorization', `Bearer ${tokenFor(recipient)}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/friend-requests — list', () => {
  it('separates incoming and outgoing pending requests', async () => {
    const me = await createUser();
    const incomingFrom = await createUser();
    const outgoingTo = await createUser();
    const acceptedWith = await createUser();

    await Relationship.create({ requester: incomingFrom._id, recipient: me._id, status: 'pending' });
    await Relationship.create({ requester: me._id, recipient: outgoingTo._id, status: 'pending' });
    await Relationship.create({ requester: me._id, recipient: acceptedWith._id, status: 'accepted' });

    const res = await request(app)
      .get('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(res.body.incoming).toHaveLength(1);
    expect(res.body.outgoing).toHaveLength(1);
    expect(res.body.incoming[0].requester.username).toBe(incomingFrom.username);
  });
});

describe('GET /api/friends — mutual friends only', () => {
  it('returns only accepted relationships, from either direction', async () => {
    const me = await createUser();
    const acceptedAsRequester = await createUser({ username: 'AcceptedA' });
    const acceptedAsRecipient = await createUser({ username: 'AcceptedB' });
    const stillPending = await createUser({ username: 'Pending' });
    const declined = await createUser({ username: 'Declined' });

    await Relationship.create({ requester: me._id, recipient: acceptedAsRequester._id, status: 'accepted' });
    await Relationship.create({ requester: acceptedAsRecipient._id, recipient: me._id, status: 'accepted' });
    await Relationship.create({ requester: me._id, recipient: stillPending._id, status: 'pending' });
    await Relationship.create({ requester: me._id, recipient: declined._id, status: 'declined' });

    const res = await request(app)
      .get('/api/friends')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    const usernames = res.body.users.map((u) => u.username).sort();
    expect(usernames).toEqual(['AcceptedA', 'AcceptedB']);
  });

  it('does not include unrelated users who have no relationship at all', async () => {
    const me = await createUser();
    await createUser({ username: 'Stranger' });

    const res = await request(app)
      .get('/api/friends')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(0);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/friends');
    expect(res.status).toBe(401);
  });
});
