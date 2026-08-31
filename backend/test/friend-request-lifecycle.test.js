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
  });
};

describe('Duplicate pending requests are rejected server-side', () => {
  it('rejects a second request while the first is still pending, regardless of frontend state', async () => {
    const me = await createUser({ username: 'Alice' });
    const rohan = await createUser({ username: 'Rohan' });

    const first = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan');
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan');
    expect(second.status).toBe(409);

    const count = await Relationship.countDocuments({ requester: me._id, recipient: rohan._id });
    expect(count).toBe(1);
  });

  it('rejects a request while an ACCEPTED relationship already exists', async () => {
    const me = await createUser({ username: 'Bob' });
    const rohan = await createUser({ username: 'Rohan2' });
    await Relationship.create({ requester: me._id, recipient: rohan._id, status: 'accepted' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan2');

    expect(res.status).toBe(409);
  });
});

describe('Decline resets the relationship so a new request can be sent later', () => {
  it('allows re-sending a request after the recipient declines it', async () => {
    const me = await createUser({ username: 'Carol' });
    const rohan = await createUser({ username: 'Rohan3' });

    const sent = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan3');
    const relationshipId = sent.body.relationship._id;

    const declined = await request(app)
      .post(`/api/friend-requests/${relationshipId}/decline`)
      .set('Authorization', `Bearer ${tokenFor(rohan)}`);
    expect(declined.status).toBe(200);
    expect(declined.body.relationship.status).toBe('declined');

    const resent = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan3');
    expect(resent.status).toBe(200);
    expect(resent.body.relationship.status).toBe('pending');

    // Reused the same row (one per direction), not a second document.
    const count = await Relationship.countDocuments({});
    expect(count).toBe(1);
  });

  it('allows the OTHER direction to send a fresh request after being declined', async () => {
    const me = await createUser({ username: 'Dave' });
    const rohan = await createUser({ username: 'Rohan4' });

    const sent = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan4');
    await request(app)
      .post(`/api/friend-requests/${sent.body.relationship._id}/decline`)
      .set('Authorization', `Bearer ${tokenFor(rohan)}`);

    // Rohan (previously declined) now sends a request to Dave instead.
    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(rohan)}`)
      .field('username', 'Dave');

    expect(res.status).toBe(200);
    const stored = await Relationship.findOne({});
    expect(stored.requester.toString()).toBe(rohan._id.toString());
    expect(stored.recipient.toString()).toBe(me._id.toString());
  });

  it('does NOT allow re-sending while still pending (declined-only reuse)', async () => {
    const me = await createUser({ username: 'Eve' });
    const rohan = await createUser({ username: 'Rohan5' });
    await Relationship.create({ requester: me._id, recipient: rohan._id, status: 'pending' });

    const res = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .field('username', 'Rohan5');

    expect(res.status).toBe(409);
  });
});

describe('POST /api/search annotates results with relationship status', () => {
  it('marks an accepted contact as "accepted" in search results', async () => {
    const me = await createUser({ username: 'Frank' });
    const friend = await createUser({ username: 'FriendlyRohan', firstName: 'Rohan' });
    await Relationship.create({ requester: me._id, recipient: friend._id, status: 'accepted' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .send({ search: 'Rohan' });

    expect(res.status).toBe(200);
    const found = res.body.users.find((u) => u.username === 'FriendlyRohan');
    expect(found).toBeDefined();
    expect(found.relationshipStatus).toBe('accepted');
  });

  it('marks a pending outgoing request as "pending"/"outgoing" in search results', async () => {
    const me = await createUser({ username: 'Grace' });
    const target = await createUser({ username: 'PendingRohan', firstName: 'Rohan' });
    await Relationship.create({ requester: me._id, recipient: target._id, status: 'pending' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .send({ search: 'Rohan' });

    const found = res.body.users.find((u) => u.username === 'PendingRohan');
    expect(found.relationshipStatus).toBe('pending');
    expect(found.relationshipDirection).toBe('outgoing');
  });

  it('does not mark a stranger with no relationship at all', async () => {
    const me = await createUser({ username: 'Henry' });
    await createUser({ username: 'StrangerRohan', firstName: 'Rohan' });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .send({ search: 'Rohan' });

    const found = res.body.users.find((u) => u.username === 'StrangerRohan');
    expect(found.relationshipStatus).toBeNull();
  });

  it('does not leak block status through search result annotation', async () => {
    const me = await createUser({ username: 'Ivy' });
    const blocked = await createUser({ username: 'BlockedRohan', firstName: 'Rohan' });
    await Relationship.create({
      requester: me._id, recipient: blocked._id, status: 'blocked', blockedBy: me._id,
    });

    const res = await request(app)
      .post('/api/search')
      .set('Authorization', `Bearer ${tokenFor(me)}`)
      .send({ search: 'Rohan' });

    const found = res.body.users.find((u) => u.username === 'BlockedRohan');
    expect(found.relationshipStatus).toBeNull();
  });
});

describe('GET /api/friends annotates every result as accepted', () => {
  it('every user returned from /api/friends carries relationshipStatus "accepted"', async () => {
    const me = await createUser({ username: 'Jack' });
    const friend = await createUser({ username: 'Rohan6' });
    await Relationship.create({ requester: me._id, recipient: friend._id, status: 'accepted' });

    const res = await request(app)
      .get('/api/friends')
      .set('Authorization', `Bearer ${tokenFor(me)}`);

    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].relationshipStatus).toBe('accepted');
    expect(res.body.users[0].username).toBe('Rohan6');
  });
});

// Phase 8 audit finding: accept.js used findOne-then-save, not an atomic
// CAS — two concurrent accept requests (double-tap, a retried request)
// could both pass the findOne status:'pending' check before either wrote,
// both save() successfully, and both fire the realtime
// friend-request:accepted emit. Fixed via findOneAndUpdate with the same
// status:'pending' filter as the actual concurrency guard.
describe('Concurrent accept requests do not double-fire', () => {
  it('only one of two simultaneous accept requests succeeds; the relationship ends up accepted exactly once', async () => {
    const me = await createUser({ username: 'Priya' });
    const requester = await createUser({ username: 'Arjun' });

    const sendRes = await request(app)
      .post('/api/friend-requests')
      .set('Authorization', `Bearer ${tokenFor(requester)}`)
      .field('username', 'Priya');
    expect(sendRes.status).toBe(200);
    const relationshipId = sendRes.body.relationship._id;

    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/friend-requests/${relationshipId}/accept`)
        .set('Authorization', `Bearer ${tokenFor(me)}`),
      request(app)
        .post(`/api/friend-requests/${relationshipId}/accept`)
        .set('Authorization', `Bearer ${tokenFor(me)}`),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one 200 (the request that won the CAS) and one 404 (the
    // status:'pending' filter no longer matches on the loser's attempt) —
    // never two 200s, which is what the pre-fix findOne-then-save allowed.
    expect(statuses).toEqual([200, 404]);

    const relationship = await Relationship.findById(relationshipId);
    expect(relationship.status).toBe('accepted');
  });
});
