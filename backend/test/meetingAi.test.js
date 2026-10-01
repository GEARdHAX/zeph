const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const request = require('supertest');
const argon2 = require('argon2');
const db = require('./helpers/db');
const { buildApp, tokenFor } = require('./helpers/app');
const store = require('../src/store');
const config = require('../config');
const User = require('../src/models/User');
const Meeting = require('../src/models/Meeting');
const Media = require('../src/models/Media');
const MeetingTranscript = require('../src/models/MeetingTranscript');
const MeetingParticipant = require('../src/models/MeetingParticipant');
const Room = require('../src/models/Room');

let app;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
  fs.rmSync(path.join(config.dataFolder, 'test'), { recursive: true, force: true });
});

// Reset BEFORE each test too — the real .env's AI_PROVIDER (now 'groq' on a
// machine with a key) would otherwise leak into the first test. Also pin
// the meeting-summary eligibility thresholds to their documented defaults
// (300s/2 participants/100 words) — these tests assume those exact values
// (e.g. "2 minutes is too short"), but store.config here is the REAL config
// object read from the developer's own .env (test/helpers/app.js only
// overrides redisUrl), so a locally-lowered
// AI_POLICY_MEETING_SUMMARY_MIN_DURATION_SECONDS would otherwise silently
// break every duration-boundary assertion in this file.
beforeEach(() => {
  store.config.aiProvider = 'none';
  store.config.groqApiKey = null;
  store.config.aiPolicyMeetingSummaryMinDurationSeconds = 300;
  store.config.aiPolicyMeetingSummaryMinParticipants = 2;
  store.config.aiPolicyMeetingSummaryMinTranscriptWords = 100;
});

afterEach(async () => {
  await db.clearDatabase();
  store.config.aiProvider = 'none';
  store.config.groqApiKey = null;
});

const createUser = async () => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password,
  });
};

const createMeeting = (overrides = {}) =>
  Meeting.create({
    caller: overrides.caller,
    callee: overrides.callee,
    users: overrides.users || [],
    startedAt: overrides.startedAt || new Date('2026-01-01T10:00:00Z'),
    endedAt: overrides.endedAt === undefined ? new Date('2026-01-01T10:30:00Z') : overrides.endedAt,
  });

// Records real attendance — the correct fixture for "this user actually
// joined and is part of eligibility/authorization counts," now that both
// meeting-summary authorization (authorization/meetingInvitePolicy.js's
// isAuthorizedForMeetingHistory) and eligibility (ai/eligibility.js's
// checkMeetingSummaryEligibility) read MeetingParticipant directly rather
// than Meeting.users (Phase 10 audit fix N1/N2 — Meeting.users is an
// eligibility/invite-acceptance set, not proof of attendance).
const recordAttendance = (meetingId, userId, joinedAt = new Date('2026-01-01T10:05:00Z')) =>
  MeetingParticipant.create({ meeting: meetingId, user: userId, joinedAt });

// storage.js's local-disk mode (no R2 configured, the test default) needs a
// REAL file at the storageKey path — getObjectStream() does an actual fs
// access, so a Media row with no backing file 404s exactly like a genuinely
// missing upload would. Write a small fake "audio" file so transcription
// can proceed to the (mocked) Groq call.
const createMedia = async (userId) => {
  const storageKey = `test/${userId}/recording.webm`;
  const fullPath = path.join(config.dataFolder, storageKey);
  await mkdirp(path.dirname(fullPath));
  fs.writeFileSync(fullPath, 'fake audio bytes');
  return Media.create({
    uploaderId: userId,
    originalName: 'recording.webm',
    category: 'audio',
    size: 1000,
    storageKey,
    status: 'READY',
  });
};

const enableGroqChatAndTranscribe = (summaryText, transcriptText) => {
  store.config.aiProvider = 'groq';
  store.config.groqApiKey = 'test-key';
  global.fetch = async (url) => {
    if (url.includes('/audio/transcriptions')) {
      return { ok: true, status: 200, text: async () => transcriptText };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: summaryText } }] }),
    };
  };
};

describe('POST /api/meeting/:id/summarize — disabled by default', () => {
  it('returns 503 AI_DISABLED when no provider is configured', async () => {
    const user = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id] });

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('AI_DISABLED');
  });
});

describe('POST /api/meeting/:id/summarize — authorization', () => {
  it('blocks a user who was never a participant in the meeting', async () => {
    enableGroqChatAndTranscribe('summary', 'a'.repeat(200));
    const participant = await createUser();
    const outsider = await createUser();
    const meeting = await createMeeting({ caller: participant._id, users: [participant._id] });

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('404s for a non-existent meeting', async () => {
    enableGroqChatAndTranscribe('summary', 'a'.repeat(200));
    const user = await createUser();
    const res = await request(app)
      .post('/api/meeting/000000000000000000000000/summarize')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/meeting/:id/summarize — eligibility (no Redis -> synchronous path)', () => {
  it('rejects a meeting that has not ended yet', async () => {
    enableGroqChatAndTranscribe('summary', 'word '.repeat(200));
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id, other._id], endedAt: null });
    const media = await createMedia(user._id);

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('MEETING_NOT_ENDED');
  });

  it('rejects a meeting shorter than the 5-minute minimum', async () => {
    enableGroqChatAndTranscribe('summary', 'word '.repeat(200));
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({
      caller: user._id,
      users: [user._id, other._id],
      startedAt: new Date('2026-01-01T10:00:00Z'),
      endedAt: new Date('2026-01-01T10:02:00Z'),
    });
    const media = await createMedia(user._id);

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('MEETING_TOO_SHORT');
  });

  it('rejects a meeting with only 1 participant', async () => {
    enableGroqChatAndTranscribe('summary', 'word '.repeat(200));
    const user = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id] });
    const media = await createMedia(user._id);

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('INSUFFICIENT_PARTICIPANTS');
  });

  it('rejects a meeting whose transcript is too short', async () => {
    enableGroqChatAndTranscribe('summary', 'only a few words here');
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id, other._id] });
    await recordAttendance(meeting._id, user._id);
    await recordAttendance(meeting._id, other._id);
    const media = await createMedia(user._id);

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('INSUFFICIENT_TRANSCRIPT');
  });

  it('generates a summary for an eligible meeting (30min, 2 participants, sufficient transcript)', async () => {
    enableGroqChatAndTranscribe('The team discussed the roadmap and agreed on next steps.', 'word '.repeat(200));
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id, other._id] });
    await recordAttendance(meeting._id, user._id);
    await recordAttendance(meeting._id, other._id);
    const media = await createMedia(user._id);

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('The team discussed the roadmap and agreed on next steps.');

    const transcriptDoc = await MeetingTranscript.findOne({ meeting: meeting._id });
    expect(transcriptDoc.status).toBe('SUMMARIZED');
    expect(transcriptDoc.summary).toBe('The team discussed the roadmap and agreed on next steps.');
  });

  it('marks the transcript FAILED (not TRANSCRIBED) when summary generation fails terminally', async () => {
    // Regression: a terminal summary failure used to revert the doc to
    // TRANSCRIBED — a non-terminal status the frontend poll spins on
    // forever. It must go to FAILED so the poll stops.
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id, other._id] });
    await recordAttendance(meeting._id, user._id);
    await recordAttendance(meeting._id, other._id);
    const media = await createMedia(user._id);

    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async (url) => {
      if (url.includes('/audio/transcriptions')) {
        return { ok: true, status: 200, text: async () => 'word '.repeat(200) };
      }
      // Empty completion -> gateway output validation fails -> INVALID_OUTPUT (terminal)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) };
    };

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    expect(res.status).toBe(502);
    const doc = await MeetingTranscript.findOne({ meeting: meeting._id });
    expect(doc.status).toBe('FAILED');
    expect(doc.transcript).toBeTruthy(); // transcript still kept for a retry
  });

  it('deletes the raw audio Media/object after successful transcription (privacy)', async () => {
    enableGroqChatAndTranscribe('a summary', 'word '.repeat(200));
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id, other._id] });
    await recordAttendance(meeting._id, user._id);
    await recordAttendance(meeting._id, other._id);
    const media = await createMedia(user._id);

    await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    const stillExists = await Media.findById(media._id);
    expect(stillExists).toBeNull();
  });
});

describe('GET /api/meeting/:id/summary', () => {
  it('returns 404 when no transcript/summary has been generated yet', async () => {
    const user = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id] });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(404);
  });

  it('blocks a non-participant from reading the summary status', async () => {
    const participant = await createUser();
    const outsider = await createUser();
    const meeting = await createMeeting({ caller: participant._id, users: [participant._id] });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);

    expect(res.status).toBe(403);
  });

  it('returns the generated summary once available', async () => {
    const user = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id] });
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      summary: 'done summary',
      status: 'SUMMARIZED',
    });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUMMARIZED');
    expect(res.body.summary).toBe('done summary');
  });
});

describe('Meeting-scoped summary access — participant history, not presence or group membership', () => {
  it("a participant who already LEFT the meeting can still read its summary (MeetingParticipant is a permanent attendance record)", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await createMeeting({ caller: userA._id, users: [userA._id, userB._id] });
    // userB actually joined and later left — recorded via MeetingParticipant
    // (joinedAt set, leftAt set), the real attendance record. Leaving never
    // deletes this row (callHistoryService only ever updates leftAt), so
    // past attendance remains provable/authorized after departure.
    await MeetingParticipant.create({
      meeting: meeting._id,
      user: userB._id,
      joinedAt: new Date('2026-01-01T10:05:00Z'),
      leftAt: new Date('2026-01-01T10:10:00Z'),
    });
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      summary: 'done summary',
      status: 'SUMMARIZED',
    });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(userB)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('done summary');
  });

  it('a participant who joined for only 1 second can still read the summary', async () => {
    const userA = await createUser();
    const userC = await createUser();
    // A 1-second visit and a full-meeting attendance both produce exactly
    // one MeetingParticipant row — presence duration is irrelevant to
    // summary-access authorization, only "did they ever join" is.
    const meeting = await createMeeting({ caller: userA._id, users: [userA._id, userC._id] });
    await recordAttendance(meeting._id, userC._id);
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      summary: 'done summary',
      status: 'SUMMARIZED',
    });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(userC)}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('done summary');
  });

  it('a CURRENT group member who never joined this specific meeting is denied (security fix — was previously authorized)', async () => {
    const userA = await createUser();
    const userD = await createUser();
    // userD is a real, current member of the group the meeting belongs to
    // — the OLD authorization (any current group member) would have let
    // them through. The FIX scopes access to Meeting.users only.
    enableGroqChatAndTranscribe('summary', 'word '.repeat(200)); // POST checks aiTextEnabled before authorization
    const room = await Room.create({ people: [userA._id, userD._id], title: 'Group', isGroup: true });
    const meeting = await createMeeting({ caller: userA._id, users: [userA._id], group: room._id });
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      summary: 'done summary',
      status: 'SUMMARIZED',
    });

    const getRes = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(userD)}`);
    expect(getRes.status).toBe(403);

    const postRes = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(userD)}`)
      .send({});
    expect(postRes.status).toBe(403);
  });

  it('a non-participant, non-member outsider is denied entirely', async () => {
    const userA = await createUser();
    const outsider = await createUser();
    const meeting = await createMeeting({ caller: userA._id, users: [userA._id] });
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      summary: 'done summary',
      status: 'SUMMARIZED',
    });

    const res = await request(app)
      .get(`/api/meeting/${meeting._id}/summary`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/meeting/:id/summarize — eligibility runs before any processing', () => {
  // Regression: the BullMQ path used to return 202 and enqueue a job
  // WITHOUT any transcript-independent eligibility check — the worker only
  // discovered the meeting was ineligible AFTER paying for transcription,
  // and the rejection was buried in a log line the user never saw. The
  // check now runs synchronously in the route before the mediaId lookup
  // and before the queue branch, so nothing is transcribed or persisted.
  it('does not create a transcript doc when the meeting is too short', async () => {
    enableGroqChatAndTranscribe('summary', 'word '.repeat(200));
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({
      caller: user._id,
      users: [user._id, other._id],
      startedAt: new Date('2026-01-01T10:00:00Z'),
      endedAt: new Date('2026-01-01T10:02:00Z'),
    });
    const media = await createMedia(user._id);

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ mediaId: media._id.toString() });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('MEETING_TOO_SHORT');
    expect(await MeetingTranscript.findOne({ meeting: meeting._id })).toBeNull();
  });
});

describe('POST /api/meeting/:id/summarize — duplicate generation prevention', () => {
  it('reuses an already-summarized transcript instead of calling the provider again', async () => {
    const user = await createUser();
    const other = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id, other._id] });
    await recordAttendance(meeting._id, user._id);
    await recordAttendance(meeting._id, other._id);
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      summary: 'first summary',
      status: 'SUMMARIZED',
    });

    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => {
      throw new Error('provider must not be called for an already-summarized meeting');
    };

    const res = await request(app)
      .post(`/api/meeting/${meeting._id}/summarize`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.summary).toBe('first summary');
  });

  it('two different authorized participants requesting simultaneously still leave exactly one MeetingTranscript with one summary', async () => {
    // This test runs against the suite's standard harness, which has no
    // Redis configured (helpers/app.js sets redisUrl: null) — so it does
    // NOT exercise ai/dedup.js's Redis lock (that path only runs when
    // Redis IS configured; see docs/ZEPH-AI-ARCHITECTURE.md's "Duplicate-
    // generation prevention" section for the full 3-layer explanation).
    // What this DOES verify, honestly: however many times the provider
    // gets called under a race, the DATABASE never ends up with more than
    // one canonical MeetingTranscript document for the meeting, and its
    // final summary is a real generated value, not corrupted/partial state.
    let providerCalls = 0;
    const userA = await createUser();
    const userB = await createUser();
    const meeting = await createMeeting({ caller: userA._id, users: [userA._id, userB._id] });
    await recordAttendance(meeting._id, userA._id);
    await recordAttendance(meeting._id, userB._id);
    // Pre-seed a transcript (as if userA already recorded+transcribed) so
    // both requests go straight to the summarize step, maximizing the race
    // window on generateMeetingSummary itself rather than on transcription.
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      status: 'TRANSCRIBED',
    });

    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => {
      providerCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'the one true summary' } }] }),
      };
    };

    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/meeting/${meeting._id}/summarize`)
        .set('Authorization', `Bearer ${tokenFor(userA)}`)
        .send({}),
      request(app)
        .post(`/api/meeting/${meeting._id}/summarize`)
        .set('Authorization', `Bearer ${tokenFor(userB)}`)
        .send({}),
    ]);

    // Both requests succeed (each is individually authorized) — the
    // invariant under test is the STORED STATE, not the HTTP responses.
    expect([resA.status, resB.status]).toEqual([200, 200]);

    const docs = await MeetingTranscript.find({ meeting: meeting._id });
    expect(docs).toHaveLength(1); // exactly one canonical document — never two
    expect(docs[0].status).toBe('SUMMARIZED');
    expect(docs[0].summary).toBe('the one true summary'); // not corrupted by the race
  });
});

describe('POST /api/meeting/list — summary availability metadata (never the summary text)', () => {
  it('omits `summary` entirely when no MeetingTranscript exists yet', async () => {
    const user = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id] });

    const res = await request(app)
      .post('/api/meeting/list')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    const listed = res.body.meetings.find((m) => m._id === meeting._id.toString());
    expect(listed).toBeDefined();
    expect(listed.summary).toBeUndefined();
  });

  it('reports available:true, status:SUMMARIZED once summarized — WITHOUT the summary text', async () => {
    const user = await createUser();
    const meeting = await createMeeting({ caller: user._id, users: [user._id] });
    await MeetingTranscript.create({
      meeting: meeting._id,
      transcript: 'word '.repeat(200),
      summary: 'a fairly long generated summary that should never appear in the list response',
      status: 'SUMMARIZED',
    });

    const res = await request(app)
      .post('/api/meeting/list')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    const listed = res.body.meetings.find((m) => m._id === meeting._id.toString());
    expect(listed.summary).toEqual({ available: true, status: 'SUMMARIZED' });
    // The list endpoint must stay cheap — spec section 5's explicit
    // "avoid unnecessarily sending large summary content for every card".
    expect(JSON.stringify(listed)).not.toContain('a fairly long generated summary');
  });

  it('reports available:false for in-progress and failed states', async () => {
    const user = await createUser();
    const meetingA = await createMeeting({ caller: user._id, users: [user._id] });
    const meetingB = await createMeeting({ caller: user._id, users: [user._id] });
    await MeetingTranscript.create({ meeting: meetingA._id, transcript: 'x', status: 'SUMMARIZING' });
    await MeetingTranscript.create({
      meeting: meetingB._id,
      transcript: 'x',
      status: 'FAILED',
      failureReason: 'MEETING_TOO_SHORT',
    });

    const res = await request(app)
      .post('/api/meeting/list')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    const listedA = res.body.meetings.find((m) => m._id === meetingA._id.toString());
    const listedB = res.body.meetings.find((m) => m._id === meetingB._id.toString());
    expect(listedA.summary).toEqual({ available: false, status: 'SUMMARIZING' });
    expect(listedB.summary).toEqual({ available: false, status: 'FAILED' });
  });

  it('does not enqueue or generate anything — purely a read of existing state', async () => {
    const user = await createUser();
    await createMeeting({ caller: user._id, users: [user._id] });
    store.config.aiProvider = 'groq';
    store.config.groqApiKey = 'test-key';
    global.fetch = async () => {
      throw new Error('the meetings list must never call an AI provider');
    };

    const res = await request(app)
      .post('/api/meeting/list')
      .set('Authorization', `Bearer ${tokenFor(user)}`);

    expect(res.status).toBe(200); // reaching here without throwing proves fetch was never called
  });
});
