const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const User = require('../src/models/User');
const Meeting = require('../src/models/Meeting');
const MeetingInvite = require('../src/models/MeetingInvite');
const MeetingInviteAcceptance = require('../src/models/MeetingInviteAcceptance');
const MeetingParticipant = require('../src/models/MeetingParticipant');
const Room = require('../src/models/Room');

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

const createMeeting = (overrides = {}) => Meeting.create({ title: 'Standup', ...overrides });

const createInvite = (actor, meetingId, extra = {}) =>
  request(app)
    .post(`/api/meetings/${meetingId}/invites`)
    .set('Authorization', `Bearer ${tokenFor(actor)}`)
    .send(extra);

const tokenFromUrl = (url) => url.split('/').pop();

describe('Meeting invite creation', () => {
  it('allows the 1:1 caller to create an invite', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, callee: callee._id });

    const res = await createInvite(caller, meeting._id);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/invite\/m\//);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('allows the 1:1 callee to create an invite too', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, callee: callee._id });

    const res = await createInvite(callee, meeting._id);
    expect(res.status).toBe(200);
  });

  it('rejects invite creation by a user unrelated to the meeting', async () => {
    const caller = await createUser();
    const callee = await createUser();
    const outsider = await createUser();
    const meeting = await createMeeting({ caller: caller._id, callee: callee._id });

    const res = await createInvite(outsider, meeting._id);
    expect(res.status).toBe(403);
  });

  it('404s when the meeting does not exist', async () => {
    const actor = await createUser();
    const res = await createInvite(actor, '6aa8ef4710b14724c1eafcdc');
    expect(res.status).toBe(404);
  });

  it('stores only a sha256 token hash, never the raw token', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const res = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(res.body.url);

    const stored = await MeetingInvite.findOne({ meeting: meeting._id });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64);
  });

  it('computes expiresAt server-side from a validated expiresIn key, ignoring an out-of-range key', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const before = Date.now();

    const res = await createInvite(caller, meeting._id, { expiresIn: 'not-a-real-option' });
    expect(res.status).toBe(200);
    // Falls back to the default (1h) instead of trusting the bogus key —
    // never in the past, never absurdly far in the future.
    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 5000);
  });

  it('honors a valid expiresIn option (15m)', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const before = Date.now();

    const res = await createInvite(caller, meeting._id, { expiresIn: '15m' });
    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(before + 14 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(before + 15 * 60 * 1000 + 5000);
  });
});

describe('Meeting invite preview', () => {
  it('returns minimal safe info, unauthenticated', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id], title: 'DSA Interview' });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app).get(`/api/meeting-invites/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.meeting.title).toBe('DSA Interview');
    expect(res.body.meeting.id).toBeDefined();
    // Nothing beyond title/id/expiresAt/invitedBy — no participant list, no peers.
    expect(res.body.meeting.peers).toBeUndefined();
    expect(res.body.meeting.users).toBeUndefined();
  });

  it('404s on an invalid token', async () => {
    const res = await request(app).get('/api/meeting-invites/not-a-real-token');
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('INVITE_NOT_FOUND');
  });

  it('rejects an expired invite even before the TTL sweep runs', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    // Force-expire without waiting for Mongo's background TTL sweep — the
    // route's own explicit expiresAt check must catch this independently.
    await MeetingInvite.updateOne({ meeting: meeting._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).get(`/api/meeting-invites/${token}`);
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('INVITE_EXPIRED');
  });

  it('rejects a revoked invite', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);
    const inviteId = created.body.inviteId;

    await request(app)
      .post(`/api/meeting-invites/${inviteId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    const res = await request(app).get(`/api/meeting-invites/${token}`);
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('INVITE_NOT_FOUND');
  });
});

describe('Meeting invite acceptance', () => {
  it('rejects an unauthenticated accept attempt', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app).post(`/api/meeting-invites/${token}/accept`);
    expect(res.status).toBe(401);
  });

  it('a registered Zeph member can accept a valid invite', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const updated = await Meeting.findById(meeting._id);
    expect(updated.users.map((u) => u.toString())).toContain(invitee._id.toString());
  });

  it('never trusts a client-supplied userId — the accepting identity always comes from the JWT', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const impersonated = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`)
      .send({ userId: impersonated._id.toString() });

    const updated = await Meeting.findById(meeting._id);
    const ids = updated.users.map((u) => u.toString());
    expect(ids).toContain(invitee._id.toString());
    expect(ids).not.toContain(impersonated._id.toString());
  });

  it('rejects accepting an expired invite', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);
    await MeetingInvite.updateOne({ meeting: meeting._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);
    expect(res.status).toBe(404);

    const updated = await Meeting.findById(meeting._id);
    expect(updated.users.map((u) => u.toString())).not.toContain(invitee._id.toString());
  });

  it('rejects accepting a revoked invite', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);
    const inviteId = created.body.inviteId;

    await request(app)
      .post(`/api/meeting-invites/${inviteId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    const res = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);
    expect(res.status).toBe(404);
  });

  it('duplicate acceptance by the same user is idempotent — one acceptance record, no double Meeting.users entry', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    const first = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);
    const second = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const acceptances = await MeetingInviteAcceptance.find({ meeting: meeting._id, user: invitee._id });
    expect(acceptances).toHaveLength(1);

    const updated = await Meeting.findById(meeting._id);
    const occurrences = updated.users.filter((u) => u.toString() === invitee._id.toString());
    expect(occurrences).toHaveLength(1);
  });

  it('a duplicate accept does not consume a second use against a limited-use invite', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id, { maxUses: 2 });
    const token = tokenFromUrl(created.body.url);

    await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);
    await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);

    const invite = await MeetingInvite.findOne({ meeting: meeting._id });
    expect(invite.useCount).toBe(1);
  });

  it('enforces maxUses across different users', async () => {
    const caller = await createUser();
    const a = await createUser();
    const b = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id, { maxUses: 1 });
    const token = tokenFromUrl(created.body.url);

    const first = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(a)}`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(b)}`);
    expect(second.status).toBe(404);
  });

  it('never grants HOST/admin standing — Meeting has no role field an invite could escalate into', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);

    const updated = await Meeting.findById(meeting._id);
    // Meeting.caller is unchanged — the invitee was added to `users` only,
    // never promoted to caller/callee.
    expect(updated.caller.toString()).toBe(caller._id.toString());
  });

  it('accepting an invite does NOT create a CallSession or MeetingParticipant row', async () => {
    const CallSession = require('../src/models/CallSession');
    const MeetingParticipant = require('../src/models/MeetingParticipant');
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);

    const sessions = await CallSession.find({ meeting: meeting._id, user: invitee._id });
    const participants = await MeetingParticipant.find({ meeting: meeting._id, user: invitee._id });
    expect(sessions).toHaveLength(0);
    expect(participants).toHaveLength(0);
  });

  // Regression: the invite creator (or anyone already connected) opening
  // their own invite link accepted successfully and got navigated straight
  // into a second callManager.join() — a real second mediasoup socket for
  // the same user with no fresh camera/mic grant, rendering as a media-less
  // "ghost" tile in the call grid (reported as a screenshot showing a
  // duplicate self-tile labeled "Spectator"). accept.js must refuse
  // acceptance outright for a user who already has an ACTIVE CallSession
  // for this meeting, rather than silently letting a redundant join happen.
  it('rejects accepting an invite while the user already has an ACTIVE CallSession for that meeting', async () => {
    const CallSession = require('../src/models/CallSession');
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    await CallSession.create({
      meeting: meeting._id,
      user: caller._id,
      socketId: 'socket-1',
      connectedAt: new Date(),
      status: 'ACTIVE',
    });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('ALREADY_IN_MEETING');
  });

  it('does not consume a use against a limited-use invite when acceptance is refused for ALREADY_IN_MEETING', async () => {
    const CallSession = require('../src/models/CallSession');
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    await CallSession.create({
      meeting: meeting._id,
      user: caller._id,
      socketId: 'socket-1',
      connectedAt: new Date(),
      status: 'ACTIVE',
    });
    const created = await createInvite(caller, meeting._id, { maxUses: 1 });
    const token = tokenFromUrl(created.body.url);

    await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    const invite = await MeetingInvite.findOne({ meeting: meeting._id });
    expect(invite.useCount).toBe(0);
  });

  it('still allows a DIFFERENT user (no active session of their own) to accept the same invite', async () => {
    const CallSession = require('../src/models/CallSession');
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    await CallSession.create({
      meeting: meeting._id,
      user: caller._id,
      socketId: 'socket-1',
      connectedAt: new Date(),
      status: 'ACTIVE',
    });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);

    expect(res.status).toBe(200);
  });

  it('allows accepting again once the prior CallSession has been closed', async () => {
    const CallSession = require('../src/models/CallSession');
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    await CallSession.create({
      meeting: meeting._id,
      user: caller._id,
      socketId: 'socket-1',
      connectedAt: new Date(),
      disconnectedAt: new Date(),
      status: 'CLOSED',
    });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);

    const res = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    expect(res.status).toBe(200);
  });
});

describe('Meeting invite revocation', () => {
  it('rejects revocation by a user unrelated to the meeting', async () => {
    const caller = await createUser();
    const outsider = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const inviteId = created.body.inviteId;

    const res = await request(app)
      .post(`/api/meeting-invites/${inviteId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);
    expect(res.status).toBe(403);
  });

  it('allows the caller to revoke their own invite', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const inviteId = created.body.inviteId;

    const res = await request(app)
      .post(`/api/meeting-invites/${inviteId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);
    expect(res.status).toBe(200);
  });

  it('revoking an invite does not remove a user who already accepted it', async () => {
    const caller = await createUser();
    const invitee = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    const created = await createInvite(caller, meeting._id);
    const token = tokenFromUrl(created.body.url);
    const inviteId = created.body.inviteId;

    await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(invitee)}`);

    await request(app)
      .post(`/api/meeting-invites/${inviteId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    const updated = await Meeting.findById(meeting._id);
    expect(updated.users.map((u) => u.toString())).toContain(invitee._id.toString());
  });
});

describe('Multiple independent invites', () => {
  it('two active invites for the same meeting have independent tokens/expiry/revocation', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });

    const inviteA = await createInvite(caller, meeting._id, { expiresIn: '15m' });
    const inviteB = await createInvite(caller, meeting._id, { expiresIn: '7d' });
    expect(tokenFromUrl(inviteA.body.url)).not.toBe(tokenFromUrl(inviteB.body.url));

    await request(app)
      .post(`/api/meeting-invites/${inviteA.body.inviteId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    const previewA = await request(app).get(`/api/meeting-invites/${tokenFromUrl(inviteA.body.url)}`);
    const previewB = await request(app).get(`/api/meeting-invites/${tokenFromUrl(inviteB.body.url)}`);
    expect(previewA.status).toBe(404);
    expect(previewB.status).toBe(200);
  });

  it('list returns every invite for a meeting with derived status, never the raw token', async () => {
    const caller = await createUser();
    const meeting = await createMeeting({ caller: caller._id, users: [caller._id] });
    await createInvite(caller, meeting._id, { expiresIn: '15m' });
    await createInvite(caller, meeting._id, { expiresIn: '7d' });

    const res = await request(app)
      .get(`/api/meetings/${meeting._id}/invites`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);

    expect(res.status).toBe(200);
    expect(res.body.invites).toHaveLength(2);
    res.body.invites.forEach((invite) => {
      expect(invite.status).toBe('ACTIVE');
      expect(invite.tokenHash).toBeUndefined();
      expect(invite.token).toBeUndefined();
    });
  });
});

// Phase 10 audit findings N1/N2, fixed in this pass:
// N1 — a current group member could create a meeting invite, accept it
//      themselves, and read the meeting's summary without ever actually
//      joining the call (authorization previously read Meeting.users, the
//      same append-only set invite-acceptance writes to — not actual
//      attendance). Fixed by authorizing summary/participants access from
//      MeetingParticipant instead (authorization/meetingInvitePolicy.js's
//      isAuthorizedForMeetingHistory).
// N2 — invites could be created for, and accepted into, a meeting that had
//      already ended, inflating Meeting.users for a meeting no one
//      attended. Fixed by rejecting both create and accept once
//      meeting.endedAt is set.
describe('Security fix (Phase 10, N1) — invite acceptance alone does not grant summary access', () => {
  it('a group member who creates and self-accepts an invite is still denied the meeting summary (never actually joined)', async () => {
    const host = await createUser();
    const groupMember = await createUser();
    const room = await Room.create({ people: [host._id, groupMember._id], title: 'Team', isGroup: true });
    const meeting = await createMeeting({ caller: host._id, group: room._id, users: [host._id] });

    // groupMember is a real, current member of the group — authorized to
    // CREATE an invite (isAuthorizedForMeeting still allows this; creating
    // a link for your own team's meeting is legitimate) and then accepts
    // it themselves, which only ever adds them to Meeting.users —
    // eligibility to join, never proof they actually did.
    const createRes = await createInvite(groupMember, meeting._id);
    expect(createRes.status).toBe(200);
    const token = tokenFromUrl(createRes.body.url);

    const acceptRes = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(groupMember)}`);
    expect(acceptRes.status).toBe(200);

    const meetingAfter = await Meeting.findById(meeting._id);
    expect(meetingAfter.users.map((u) => u.toString())).toContain(groupMember._id.toString());

    // No MeetingParticipant row was ever created (accept.js never writes
    // one — only mediasoup/index.js's real 'join' socket handler does), so
    // despite now being in Meeting.users, summary/participants access must
    // still be denied.
    const summaryRes = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(groupMember)}`);
    expect(summaryRes.status).toBe(403);
    expect(summaryRes.body.reason).toBe('NOT_A_PARTICIPANT');

    const participantsRes = await request(app)
      .get(`/api/meeting/${meeting._id}/participants`)
      .set('Authorization', `Bearer ${tokenFor(groupMember)}`);
    expect(participantsRes.status).toBe(403);
  });

  it('a user with a real MeetingParticipant row (actually joined) IS authorized for the summary', async () => {
    const host = await createUser();
    const attendee = await createUser();
    const meeting = await createMeeting({ caller: host._id, users: [host._id, attendee._id], endedAt: new Date() });
    await MeetingParticipant.create({ meeting: meeting._id, user: attendee._id, joinedAt: new Date() });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(attendee)}`);
    // 404 (no transcript doc yet) proves authorization passed — a 403
    // would mean the fix wrongly denied a real attendee.
    expect(res.status).toBe(404);
  });
});

describe('Security fix (Phase 10, N2) — invites cannot be created or accepted for an ended meeting', () => {
  it('rejects creating a new invite for a meeting that has already ended', async () => {
    const host = await createUser();
    const meeting = await createMeeting({ caller: host._id, users: [host._id], endedAt: new Date() });

    const res = await createInvite(host, meeting._id);
    expect(res.status).toBe(410);
    expect(res.body.reason).toBe('MEETING_ENDED');
  });

  it('rejects accepting a valid (unexpired, unrevoked) invite once the meeting has since ended', async () => {
    const host = await createUser();
    const stranger = await createUser();
    const meeting = await createMeeting({ caller: host._id, users: [host._id] });

    const createRes = await createInvite(host, meeting._id);
    expect(createRes.status).toBe(200);
    const token = tokenFromUrl(createRes.body.url);

    // Meeting ends AFTER the invite was created but before it's accepted —
    // the invite itself is still "valid" (not expired/revoked/exhausted).
    await Meeting.updateOne({ _id: meeting._id }, { endedAt: new Date() });

    const acceptRes = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(stranger)}`);
    expect(acceptRes.status).toBe(410);
    expect(acceptRes.body.reason).toBe('MEETING_ENDED');

    // The use-count claimed atomically before this rejection must be
    // refunded — a rejected accept must not burn into maxUses.
    const inviteAfter = await MeetingInvite.findOne({ meeting: meeting._id });
    expect(inviteAfter.useCount).toBe(0);

    // Stranger must NOT have been added to Meeting.users either.
    const meetingAfter = await Meeting.findById(meeting._id);
    expect(meetingAfter.users.map((u) => u.toString())).not.toContain(stranger._id.toString());
  });

  it('a meeting-ended rejection does not prevent a DIFFERENT, still-active invite from working', async () => {
    const host = await createUser();
    const attendee = await createUser();
    const meeting = await createMeeting({ caller: host._id, users: [host._id] });

    const createRes = await createInvite(host, meeting._id);
    const token = tokenFromUrl(createRes.body.url);

    const acceptRes = await request(app)
      .post(`/api/meeting-invites/${token}/accept`)
      .set('Authorization', `Bearer ${tokenFor(attendee)}`);
    expect(acceptRes.status).toBe(200);
  });
});
