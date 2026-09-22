const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Relationship = require('../src/models/Relationship');
const Report = require('../src/models/Report');

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
    level: overrides.level || 'standard',
  });
};

const createRoom = (people) => Room.create({ people: people.map((u) => u._id), isGroup: false });

const submitReport = (actor, extra = {}) =>
  request(app).post('/api/reports').set('Authorization', `Bearer ${tokenFor(actor)}`).send(extra);

describe('Report creation', () => {
  it('allows a room member to report another member', async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);

    const res = await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const stored = await Report.findOne({ reporter: reporter._id, reportedUser: reported._id });
    expect(stored).toBeDefined();
    expect(stored.status).toBe('OPEN');
  });

  it('rejects reporting yourself', async () => {
    const reporter = await createUser();
    const room = await createRoom([reporter]);

    const res = await submitReport(reporter, { roomID: room._id, reportedUserId: reporter._id, reason: 'SPAM' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('SELF_REPORT');
  });

  it('rejects an invalid reason', async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);

    const res = await submitReport(reporter, {
      roomID: room._id,
      reportedUserId: reported._id,
      reason: 'NOT_A_REAL_REASON',
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('INVALID_REASON');
  });

  it('rejects reporting a user not in the given room (IDOR guard)', async () => {
    const reporter = await createUser();
    const outsider = await createUser();
    const room = await createRoom([reporter]);

    const res = await submitReport(reporter, { roomID: room._id, reportedUserId: outsider._id, reason: 'SPAM' });
    expect(res.status).toBe(403);
  });

  it('rejects a non-member of the room from filing a report at all', async () => {
    const memberA = await createUser();
    const memberB = await createUser();
    const outsider = await createUser();
    const room = await createRoom([memberA, memberB]);

    const res = await submitReport(outsider, { roomID: room._id, reportedUserId: memberB._id, reason: 'SPAM' });
    expect(res.status).toBe(403);
  });

  it('404s on a nonexistent room', async () => {
    const reporter = await createUser();
    const res = await submitReport(reporter, {
      roomID: '6aa8ef4710b14724c1eafcdc',
      reportedUserId: (await createUser())._id,
      reason: 'SPAM',
    });
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated report attempt', async () => {
    const room = await createRoom([await createUser()]);
    const res = await request(app).post('/api/reports').send({ roomID: room._id, reason: 'SPAM' });
    expect(res.status).toBe(401);
  });

  it('caps free-text details at 1000 characters server-side', async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);
    const longText = 'x'.repeat(5000);

    await submitReport(reporter, {
      roomID: room._id,
      reportedUserId: reported._id,
      reason: 'OTHER',
      details: longText,
    });

    const stored = await Report.findOne({ reporter: reporter._id, reportedUser: reported._id });
    expect(stored.details.length).toBe(1000);
  });

  // The real point of reporting: it must stay possible when the two users
  // have blocked each other — unlike authorizeAction()'s generic block
  // check, reporting doesn't go through that gate at all.
  it('still allows reporting a user the reporter has blocked', async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);
    await Relationship.create({
      requester: reporter._id,
      recipient: reported._id,
      status: 'blocked',
      blockedBy: reporter._id,
    });

    const res = await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'HARASSMENT' });
    expect(res.status).toBe(200);
  });

  it('re-submitting while an earlier OPEN report on the same person/room exists updates it in place, not a duplicate row', async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);

    await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });
    await submitReport(reporter, {
      roomID: room._id,
      reportedUserId: reported._id,
      reason: 'HARASSMENT',
      details: 'updated details',
    });

    const reports = await Report.find({ reporter: reporter._id, reportedUser: reported._id });
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe('HARASSMENT');
    expect(reports[0].details).toBe('updated details');
  });

  it('a NEW report can be filed once the prior one has been reviewed (not stuck merging forever)', async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);

    const first = await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });
    await Report.updateOne({ _id: first.body.reportId }, { $set: { status: 'DISMISSED' } });

    await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SCAM' });

    const reports = await Report.find({ reporter: reporter._id, reportedUser: reported._id });
    expect(reports).toHaveLength(2);
  });
});

describe('Report listing (admin-only)', () => {
  it('rejects a standard user with 404 (anti-enumeration)', async () => {
    const standard = await createUser();
    const res = await request(app).get('/api/reports').set('Authorization', `Bearer ${tokenFor(standard)}`);
    expect(res.status).toBe(404);
  });

  it('allows a privileged user to list reports', async () => {
    const admin = await createUser({ level: 'admin' });
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);
    await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });

    const res = await request(app).get('/api/reports').set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
    expect(res.body.reports[0].reporter.username).toBe(reporter.username);
    // accountStatus must come through on reportedUser — the admin Reports
    // page uses it to show whether the account is already suspended and
    // to decide whether the row's action button reads Suspend or Reactivate.
    expect(res.body.reports[0].reportedUser.accountStatus).toBe('ACTIVE');
  });

  it('filters by status', async () => {
    const admin = await createUser({ level: 'admin' });
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);
    const created = await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });
    await Report.updateOne({ _id: created.body.reportId }, { $set: { status: 'DISMISSED' } });

    const openRes = await request(app)
      .get('/api/reports')
      .query({ status: 'OPEN' })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(openRes.body.reports).toHaveLength(0);

    const dismissedRes = await request(app)
      .get('/api/reports')
      .query({ status: 'DISMISSED' })
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(dismissedRes.body.reports).toHaveLength(1);
  });
});

describe('Report review (admin-only)', () => {
  it('rejects a standard user with 404', async () => {
    const standard = await createUser();
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);
    const created = await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });

    const res = await request(app)
      .post(`/api/reports/${created.body.reportId}/review`)
      .set('Authorization', `Bearer ${tokenFor(standard)}`)
      .send({ status: 'DISMISSED' });
    expect(res.status).toBe(404);
  });

  it('allows a privileged user to mark a report ACTIONED and stamps reviewedBy/reviewedAt', async () => {
    const admin = await createUser({ level: 'admin' });
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);
    const created = await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });

    const res = await request(app)
      .post(`/api/reports/${created.body.reportId}/review`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ status: 'ACTIONED' });
    expect(res.status).toBe(200);

    const stored = await Report.findById(created.body.reportId);
    expect(stored.status).toBe('ACTIONED');
    expect(stored.reviewedBy.toString()).toBe(admin._id.toString());
    expect(stored.reviewedAt).not.toBeNull();
  });

  it('rejects an invalid status', async () => {
    const admin = await createUser({ level: 'admin' });
    const reporter = await createUser();
    const reported = await createUser();
    const room = await createRoom([reporter, reported]);
    const created = await submitReport(reporter, { roomID: room._id, reportedUserId: reported._id, reason: 'SPAM' });

    const res = await request(app)
      .post(`/api/reports/${created.body.reportId}/review`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ status: 'OPEN' });
    expect(res.status).toBe(400);
  });
});
