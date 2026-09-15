// Call Timeline / Call History — API-level tests for the two new
// endpoints: GET /api/calls/history (self-service, JWT-derived userId
// only — spec §12) and GET /api/meeting/:id/participants (meeting-scoped,
// participant-only — spec §10).
const request = require('supertest');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Meeting = require('../src/models/Meeting');
const callHistoryService = require('../src/services/callHistoryService');

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

const createUser = async () =>
  User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password: 'irrelevant-not-hashed-for-this-test',
  });

describe('GET /api/calls/history', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/calls/history');
    expect(res.status).toBe(401);
  });

  it("a user retrieves their OWN history, including sessions and timeline", async () => {
    const user = await createUser();
    const meeting = await Meeting.create({ title: 'Standup', caller: user._id });
    const session = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });
    await callHistoryService.recordDisconnected({ socketId: 'socket-1', reason: 'left' });

    const res = await request(app).get('/api/calls/history').set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    const entry = res.body.history[0];
    expect(entry.meetingId).toBe(meeting._id.toString());
    expect(entry.sessions).toHaveLength(1);
    expect(entry.sessions[0].disconnectReason).toBe('left');
    expect(entry.timeline.map((e) => e.eventType)).toEqual(['CONNECTED', 'DISCONNECTED']);
    expect(entry.totalDurationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("a user's own history request never returns another user's sessions — userId comes only from the JWT", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await Meeting.create({ title: 'Sync', caller: userA._id, users: [userA._id, userB._id] });
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: userA._id, socketId: 'a-socket' });
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: userB._id, socketId: 'b-socket' });

    // userB authenticates as themselves — even if they somehow tried to
    // pass userA's id, this route has no userId input at all to trust.
    const res = await request(app).get('/api/calls/history').set('Authorization', `Bearer ${tokenFor(userB)}`);

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].sessions).toHaveLength(1); // only userB's own session, never userA's
  });

  it('?meetingId= narrows to a single meeting (used by the per-meeting timeline popup)', async () => {
    const user = await createUser();
    const meetingA = await Meeting.create({ title: 'A' });
    const meetingB = await Meeting.create({ title: 'B' });
    await callHistoryService.recordConnected({ meetingId: meetingA._id, userId: user._id, socketId: 's-a' });
    await callHistoryService.recordConnected({ meetingId: meetingB._id, userId: user._id, socketId: 's-b' });

    const res = await request(app)
      .get(`/api/calls/history?meetingId=${meetingA._id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].meetingId).toBe(meetingA._id.toString());
  });

  it('rejects a malformed ?meetingId= with 400 instead of crashing', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/calls/history?meetingId=not-a-valid-object-id')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(400);
  });

  it('supports cursor pagination', async () => {
    const user = await createUser();
    for (let i = 0; i < 3; i += 1) {
      const meeting = await Meeting.create({ title: `Meeting ${i}` });
      // eslint-disable-next-line no-await-in-loop
      await callHistoryService.recordConnected({ meetingId: meeting._id, userId: user._id, socketId: `socket-${i}` });
    }

    const firstPage = await request(app)
      .get('/api/calls/history?limit=2')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(firstPage.body.history).toHaveLength(2);
    expect(firstPage.body.cursor).not.toBeNull();

    const secondPage = await request(app)
      .get(`/api/calls/history?limit=2&cursor=${encodeURIComponent(firstPage.body.cursor)}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(secondPage.body.history).toHaveLength(1);
  });
});

describe('GET /api/meeting/:id/participants', () => {
  it('a participant can retrieve the participant list', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await Meeting.create({ caller: userA._id, users: [userA._id, userB._id] });
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: userA._id, socketId: 's1' });
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: userB._id, socketId: 's2' });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/participants`)
      .set('Authorization', `Bearer ${tokenFor(userA)}`);

    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(2);
    // No private technical metadata (spec §10) — only user + joinedAt/leftAt.
    const keys = Object.keys(res.body.participants[0]).sort();
    expect(keys).toEqual(['joinedAt', 'leftAt', 'user']);
  });

  it('a user who never joined the meeting cannot retrieve participants', async () => {
    const userA = await createUser();
    const outsider = await createUser();
    const meeting = await Meeting.create({ caller: userA._id, users: [userA._id] });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/participants`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);

    expect(res.status).toBe(403);
  });

  it('404s for a non-existent meeting', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/meeting/000000000000000000000000/participants')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/meeting/list — participation rollup (spec §19)', () => {
  it("attaches the CURRENT user's own session count + total duration, never another participant's", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await Meeting.create({ caller: userA._id, users: [userA._id, userB._id] });

    // userA joins twice (reconnect); userB joins once — their rollups must
    // stay independent.
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: userA._id, socketId: 'a1' });
    await callHistoryService.recordDisconnected({ socketId: 'a1', reason: 'network' });
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: userA._id, socketId: 'a2' });
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: userB._id, socketId: 'b1' });

    const asA = await request(app).post('/api/meeting/list').set('Authorization', `Bearer ${tokenFor(userA)}`);
    const listedForA = asA.body.meetings.find((m) => m._id === meeting._id.toString());
    expect(listedForA.participation.sessionCount).toBe(2);

    const asB = await request(app).post('/api/meeting/list').set('Authorization', `Bearer ${tokenFor(userB)}`);
    const listedForB = asB.body.meetings.find((m) => m._id === meeting._id.toString());
    expect(listedForB.participation.sessionCount).toBe(1);
  });

  it('omits `participation` entirely when the user has no CallSession for that meeting', async () => {
    const user = await createUser();
    const meeting = await Meeting.create({ caller: user._id, users: [user._id] });

    const res = await request(app).post('/api/meeting/list').set('Authorization', `Bearer ${tokenFor(user)}`);
    const listed = res.body.meetings.find((m) => m._id === meeting._id.toString());
    expect(listed.participation).toBeUndefined();
  });
});
