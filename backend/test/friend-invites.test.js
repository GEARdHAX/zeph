const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Relationship = require('../src/models/Relationship');
const FriendInvite = require('../src/models/FriendInvite');

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

const createInvite = (inviter) => request(app)
  .post('/api/friends/invites')
  .set('Authorization', `Bearer ${tokenFor(inviter)}`);

const tokenFromUrl = (url) => url.split('/').pop();

describe('Friend invite creation', () => {
  it('returns an invite URL and stores only a hash, never the raw token', async () => {
    const inviter = await createUser();
    const res = await createInvite(inviter);

    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/invite\/f\//);

    const token = tokenFromUrl(res.body.url);
    const stored = await FriendInvite.findOne({ inviter: inviter._id });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64); // sha256 hex
  });
});

describe('Friend invite preview', () => {
  it('returns only inviter display info, unauthenticated', async () => {
    const inviter = await createUser({ username: 'Inviter' });
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app).get(`/api/friends/invites/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.inviter.username).toBe('Inviter');
    expect(res.body.inviter.password).toBeUndefined();
  });

  it('404s on an invalid token', async () => {
    const res = await request(app).get('/api/friends/invites/not-a-real-token');
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('INVITE_NOT_FOUND');
  });

  it('404s on an expired token (TTL semantics simulated by manual expiry)', async () => {
    const inviter = await createUser();
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);
    await FriendInvite.updateOne({ inviter: inviter._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    // TTL index runs on Mongo's background sweep (not instant in tests), so
    // this exercises the same "not found" path the sweep will eventually
    // produce, not the sweep itself.
    await FriendInvite.deleteOne({ inviter: inviter._id, expiresAt: { $lt: new Date() } });
    const res = await request(app).get(`/api/friends/invites/${token}`);
    expect(res.status).toBe(404);
  });
});

describe('Friend invite acceptance', () => {
  it('creates a mutual friendship and marks the invite used', async () => {
    const inviter = await createUser();
    const accepter = await createUser();
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/friends/invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(accepter)}`);

    expect(res.status).toBe(200);
    expect(res.body.relationship.status).toBe('accepted');

    const relationship = await Relationship.findOne({ requester: inviter._id, recipient: accepter._id });
    expect(relationship.status).toBe('accepted');

    const invite = await FriendInvite.findOne({ inviter: inviter._id });
    expect(invite.usedAt).not.toBeNull();
    expect(invite.usedBy.toString()).toBe(accepter._id.toString());
  });

  it('rejects a self-invite', async () => {
    const inviter = await createUser();
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/friends/invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(inviter)}`);

    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('SELF_INVITE');
  });

  it('rejects acceptance when already friends', async () => {
    const inviter = await createUser();
    const accepter = await createUser();
    await Relationship.create({ requester: inviter._id, recipient: accepter._id, status: 'accepted' });
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/friends/invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(accepter)}`);

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('ALREADY_FRIENDS');
  });

  it('rejects a second acceptance of an already-used invite', async () => {
    const inviter = await createUser();
    const accepter = await createUser();
    const other = await createUser();
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);

    const first = await request(app)
      .post(`/api/friends/invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(accepter)}`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/friends/invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(other)}`);
    expect(second.status).toBe(404);
  });

  it('handles two concurrent accept attempts on the same invite as exactly one success', async () => {
    const inviter = await createUser();
    const a = await createUser();
    const b = await createUser();
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/friends/invites/${token}/accept`).set('Authorization', `Bearer ${tokenFor(a)}`),
      request(app).post(`/api/friends/invites/${token}/accept`).set('Authorization', `Bearer ${tokenFor(b)}`),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 404]);
  });

  it('404s on an invalid token', async () => {
    const accepter = await createUser();
    const res = await request(app)
      .post('/api/friends/invites/not-a-real-token/accept')
      .set('Authorization', `Bearer ${tokenFor(accepter)}`);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated acceptance', async () => {
    const inviter = await createUser();
    const created = await createInvite(inviter);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app).post(`/api/friends/invites/${token}/accept`);
    expect(res.status).toBe(401);
  });
});

describe('Friend invite rate limiting', () => {
  it('returns 429 after exceeding the creation limit', async () => {
    const inviter = await createUser();
    let last;
    for (let i = 0; i < 21; i++) {
      last = await createInvite(inviter);
    }
    expect(last.status).toBe(429);
  });
});
