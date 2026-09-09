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
// machine with a key) would otherwise leak into the first test.
beforeEach(() => {
  store.config.aiProvider = 'none';
  store.config.groqApiKey = null;
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
});
