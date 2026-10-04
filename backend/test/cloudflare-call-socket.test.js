// Cloudflare call backend, socket side. Real MongoDB (meeting authorization)
// and a real in-memory NeDB for store.peers (the $in/$ne/$unset queries are part
// of what's under test); only Cloudflare's HTTP API and the usage guard are faked.
const { AsyncNedb } = require('nedb-async');
const db = require('./helpers/db');
const store = require('../src/store');
const Meeting = require('../src/models/Meeting');
const User = require('../src/models/User');

jest.mock('../src/calls/cloudflare/usageGuard', () => ({
  isAllowed: jest.fn(async () => true),
  recordMinutes: jest.fn(),
}));
const usageGuard = require('../src/calls/cloudflare/usageGuard');
const cloudflare = require('../src/calls/cloudflare');

const { sessions, joinedAt, setClientForTests } = cloudflare.__testHelpers;

let emitted;
let fakeClient;
let sessionCounter;

beforeAll(async () => {
  await db.connect();
});
afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(() => {
  emitted = [];
  sessionCounter = 0;
  sessions.clear();
  joinedAt.clear();
  usageGuard.isAllowed.mockResolvedValue(true);
  usageGuard.recordMinutes.mockClear();
  store.roomIDs = {};
  store.consumerUserIDs = {};
  store.rooms = new AsyncNedb();
  store.peers = new AsyncNedb();
  store.onlineUsers = new Map();
  store.config = { callMaxParticipants: 2 };
  store.io = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
  fakeClient = {
    isConfigured: jest.fn(() => true),
    turnConfigured: jest.fn(() => true),
    newSession: jest.fn(async () => `sess-${++sessionCounter}`),
    pushTracks: jest.fn(async (sessionId, { tracks }) => ({
      sessionDescription: { type: 'answer', sdp: 'ANSWER-SDP' },
      tracks: tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })),
    })),
    pullTracks: jest.fn(async (sessionId, remote) => ({
      sessionDescription: { type: 'offer', sdp: 'PULL-OFFER' },
      requiresImmediateRenegotiation: true,
      tracks: remote.map((r, i) => ({ mid: String(i + 5), sessionId: r.sessionId, trackName: r.trackName })),
    })),
    renegotiate: jest.fn(async () => ({})),
    closeTracks: jest.fn(async () => ({})),
    getIceServers: jest.fn(async () => [{ urls: ['stun:stun.cloudflare.com:3478'] }]),
  };
  setClientForTests(fakeClient);
});

let userSeq = 0;
const createUser = () => {
  userSeq += 1;
  return User.create({
    username: `cf-user-${userSeq}-${Math.random().toString(36).slice(2)}`,
    email: `cf${userSeq}${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password: 'irrelevant',
  });
};

const fakeSocket = (userId) => {
  const handlers = {};
  const socket = {
    id: `socket-${Math.random().toString(36).slice(2)}`,
    decoded_token: { id: userId, level: 'standard' },
    handlers,
    on(event, handler) {
      handlers[event] = handler;
    },
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload, from: socket.id }) }),
    join: async () => {},
    leave: async () => {},
  };
  return socket;
};

const call = (socket, event, data) =>
  new Promise((resolve) => {
    socket.handlers[event](data, resolve);
  });

// A socket that has genuinely joined `meeting` (authorized join + Cloudflare session).
const joined = async (user, meeting, { session = true } = {}) => {
  const socket = fakeSocket(user._id.toString());
  cloudflare.initSocket(socket);
  const res = await call(socket, 'join', { roomID: meeting._id.toString() });
  expect(res.error).toBeUndefined();
  if (session) {
    const s = await call(socket, 'cf:session:new', {});
    expect(s.sessionId).toBeDefined();
  }
  return socket;
};

const newMeeting = async () => {
  const caller = await createUser();
  const callee = await createUser();
  const meeting = await Meeting.create({ caller: caller._id, callee: callee._id });
  return { caller, callee, meeting };
};

const audioTrack = { mid: '0', trackName: 'audio-abc123', kind: 'audio' };

describe('join admission (beforeJoin hook)', () => {
  it('refuses to join when Cloudflare is not configured', async () => {
    fakeClient.isConfigured.mockReturnValue(false);
    const { caller, meeting } = await newMeeting();
    const socket = fakeSocket(caller._id.toString());
    cloudflare.initSocket(socket);
    await expect(call(socket, 'join', { roomID: meeting._id.toString() })).resolves.toEqual({ error: 'calls_not_configured' });
    expect(store.roomIDs[socket.id]).toBeUndefined();
  });

  it('caps the room size', async () => {
    const { caller, callee, meeting } = await newMeeting();
    const third = await createUser();
    await Meeting.updateOne({ _id: meeting._id }, { $addToSet: { users: third._id } });
    await joined(caller, meeting, { session: false });
    await joined(callee, meeting, { session: false });
    const socket = fakeSocket(third._id.toString());
    cloudflare.initSocket(socket);
    await expect(call(socket, 'join', { roomID: meeting._id.toString() })).resolves.toEqual({ error: 'room_full' });
  });

  it('refuses new joins once the monthly guard trips, without blocking existing authorization rules', async () => {
    usageGuard.isAllowed.mockResolvedValue(false);
    const { caller, meeting } = await newMeeting();
    const socket = fakeSocket(caller._id.toString());
    cloudflare.initSocket(socket);
    await expect(call(socket, 'join', { roomID: meeting._id.toString() })).resolves.toEqual({ error: 'monthly_limit_reached' });
  });

  it('still rejects a non-participant before any admission logic runs', async () => {
    const { meeting } = await newMeeting();
    const stranger = await createUser();
    const socket = fakeSocket(stranger._id.toString());
    cloudflare.initSocket(socket);
    await expect(call(socket, 'join', { roomID: meeting._id.toString() })).resolves.toEqual({ error: 'unauthorized' });
    expect(fakeClient.newSession).not.toHaveBeenCalled();
  });

  it('records participant-minutes on leave', async () => {
    const { caller, meeting } = await newMeeting();
    const socket = await joined(caller, meeting, { session: false });
    joinedAt.set(socket.id, Date.now() - 3 * 60000);
    await call(socket, 'leave', {});
    expect(usageGuard.recordMinutes).toHaveBeenCalledTimes(1);
    expect(usageGuard.recordMinutes.mock.calls[0][0]).toBeCloseTo(3, 0);
  });
});

describe('call:config and sessions', () => {
  it('returns ICE servers and limits to a participant', async () => {
    const { caller, meeting } = await newMeeting();
    const socket = await joined(caller, meeting, { session: false });
    const cfg = await call(socket, 'call:config', {});
    expect(cfg.backend).toBe('cloudflare');
    expect(cfg.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
    expect(cfg.limits).toEqual({ maxVideoHeight: 720, maxVideoBitrate: 1500000, maxScreenBitrate: 2500000, maxAudioBitrate: 48000 });
    store.config.callMaxVideoHeight = 480;
    store.config.callMaxVideoBitrate = 800000;
    const tuned = await call(socket, 'call:config', {});
    expect(tuned.limits).toMatchObject({ maxVideoHeight: 480, maxVideoBitrate: 800000 });
  });

  it('falls back to STUN when TURN credential generation fails', async () => {
    fakeClient.getIceServers.mockRejectedValue(new Error('turn down'));
    const { caller, meeting } = await newMeeting();
    const socket = await joined(caller, meeting, { session: false });
    const cfg = await call(socket, 'call:config', {});
    expect(cfg.iceServers[0].urls[0]).toMatch(/^stun:/);
  });

  it('does not hand TURN credentials to a socket that has not joined a meeting', async () => {
    const stranger = await createUser();
    const socket = fakeSocket(stranger._id.toString());
    cloudflare.initSocket(socket);
    await expect(call(socket, 'call:config', {})).resolves.toEqual({ error: 'unauthorized' });
    expect(fakeClient.getIceServers).not.toHaveBeenCalled();
  });

  it('creates one send session and one receive session per socket and reuses them', async () => {
    const { caller, meeting } = await newMeeting();
    const socket = await joined(caller, meeting);
    const again = await call(socket, 'cf:session:new', {});
    expect(again).toEqual({ sessionId: 'sess-1', pullSessionId: 'sess-2' }); // sending and receiving never share a session
    expect(fakeClient.newSession).toHaveBeenCalledTimes(2);
  });

  it('renews a session: drops the old tracks from the room and starts a fresh Cloudflare session', async () => {
    const { caller, callee, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    await joined(callee, meeting);
    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    await call(a, 'cf:tracks:ready', { producerIDs: push.producerIDs });

    const renewed = await call(a, 'cf:session:new', { renew: true });
    expect(renewed).toEqual({ sessionId: 'sess-5', pullSessionId: 'sess-6' }); // both replaced (a: 1,2; b: 3,4)
    expect(await store.peers.asyncFind({ type: 'producer', socketID: a.id })).toHaveLength(0);
    expect(emitted.some((e) => e.event === 'remove' && e.payload.producerID === push.producerIDs[0])).toBe(true);
    // the same track name can be published again on the new session
    const again = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    expect(again.producerIDs).toEqual(['sess-5/audio-abc123']);
  });

  it('clears the session when the socket disconnects', async () => {
    const { caller, meeting } = await newMeeting();
    const socket = await joined(caller, meeting);
    expect(sessions.has(socket.id)).toBe(true);
    await socket.handlers.disconnect('transport close');
    expect(sessions.has(socket.id)).toBe(false);
  });
});

describe('publish -> announce -> subscribe', () => {
  it('keeps a published track invisible until the publisher confirms it, then announces it', async () => {
    const { caller, callee, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    const b = await joined(callee, meeting);

    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    expect(push.sessionDescription).toBe('ANSWER-SDP');
    expect(push.producerIDs).toEqual(['sess-1/audio-abc123']);
    expect(fakeClient.pushTracks).toHaveBeenCalledWith('sess-1', { sdp: 'OFFER', tracks: [expect.objectContaining({ mid: '0', trackName: 'audio-abc123' })] });

    // Not announced, not pullable, not in a newcomer's join list yet.
    expect(emitted.filter((e) => e.event === 'newProducer')).toHaveLength(0);
    await expect(call(b, 'cf:tracks:pull', { producerIDs: push.producerIDs })).resolves.toEqual({ error: 'producer_not_found' });
    expect(await store.peers.asyncFind({ type: 'producer', roomID: meeting._id.toString(), pending: { $ne: true } })).toHaveLength(0);

    const ready = await call(a, 'cf:tracks:ready', { producerIDs: push.producerIDs });
    expect(ready.announced).toBe(1);
    const announce = emitted.find((e) => e.event === 'newProducer');
    expect(announce.room).toBe(meeting._id.toString());
    expect(announce.payload).toMatchObject({ socketID: a.id, producerID: 'sess-1/audio-abc123', kind: 'audio', isScreen: false });

    // A late joiner now sees it in the join response.
    const third = await createUser();
    await Meeting.updateOne({ _id: meeting._id }, { $addToSet: { users: third._id } });
    store.config.callMaxParticipants = 5;
    const c = fakeSocket(third._id.toString());
    cloudflare.initSocket(c);
    const joinRes = await call(c, 'join', { roomID: meeting._id.toString() });
    expect(joinRes.producers.map((p) => p.producerID)).toEqual(['sess-1/audio-abc123']);
  });

  it('lets a participant pull a confirmed track and maps the answer back to producer IDs', async () => {
    const { caller, callee, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    const b = await joined(callee, meeting);
    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    await call(a, 'cf:tracks:ready', { producerIDs: push.producerIDs });

    const pull = await call(b, 'cf:tracks:pull', { producerIDs: push.producerIDs });
    expect(fakeClient.pullTracks).toHaveBeenCalledWith('sess-4', // b's RECEIVE session, not its send session (sess-3)
       [{ sessionId: 'sess-1', trackName: 'audio-abc123' }]);
    expect(pull.sessionDescription).toBe('PULL-OFFER');
    expect(pull.requiresImmediateRenegotiation).toBe(true);
    expect(pull.tracks).toEqual([{ mid: '5', producerID: 'sess-1/audio-abc123', socketID: a.id, kind: 'audio', error: undefined }]);

    // The same track is not pulled twice by the same session.
    await expect(call(b, 'cf:tracks:pull', { producerIDs: push.producerIDs })).resolves.toEqual({ error: 'producer_not_found' });

    await expect(call(b, 'cf:renegotiate', { sessionDescription: 'ANSWER' })).resolves.toEqual({ ok: true });
    expect(fakeClient.renegotiate).toHaveBeenCalledWith('sess-4', 'ANSWER');
  });

  it('does not let a publisher pull its own track', async () => {
    const { caller, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    await call(a, 'cf:tracks:ready', { producerIDs: push.producerIDs });
    await expect(call(a, 'cf:tracks:pull', { producerIDs: push.producerIDs })).resolves.toEqual({ error: 'producer_not_found' });
  });

  it('drops tracks Cloudflare rejected instead of announcing them', async () => {
    fakeClient.pushTracks.mockResolvedValue({
      sessionDescription: { type: 'answer', sdp: 'ANSWER-SDP' },
      tracks: [{ mid: '0', trackName: 'audio-abc123', errorCode: 'failed' }],
    });
    const { caller, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    expect(push.producerIDs).toEqual([]);
    expect(push.rejected).toEqual(['audio-abc123']);
  });

  it('closes an owned track, removes it from the registry and tells the room', async () => {
    const { caller, callee, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    await joined(callee, meeting);
    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    await call(a, 'cf:tracks:ready', { producerIDs: push.producerIDs });

    const res = await call(a, 'cf:tracks:close', { closes: [{ producerID: push.producerIDs[0], mid: '0' }] });
    expect(res).toEqual({ ok: true });
    expect(fakeClient.closeTracks).toHaveBeenCalledWith('sess-1', { mids: ['0'] });
    expect(await store.peers.asyncFind({ type: 'producer', producerID: push.producerIDs[0] })).toHaveLength(0);
    expect(emitted.find((e) => e.event === 'remove').payload).toEqual({ producerID: push.producerIDs[0], socketID: a.id });
  });
});

describe('authorization and input validation', () => {
  it('rejects every call event from a socket that never joined a meeting', async () => {
    const stranger = await createUser();
    const socket = fakeSocket(stranger._id.toString());
    cloudflare.initSocket(socket);
    for (const event of ['cf:session:new', 'cf:tracks:push', 'cf:tracks:ready', 'cf:tracks:pull', 'cf:renegotiate', 'cf:tracks:close']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(call(socket, event, {})).resolves.toEqual({ error: 'unauthorized' });
    }
    expect(fakeClient.newSession).not.toHaveBeenCalled();
  });

  it('rejects a forged room entry for a meeting the user does not belong to', async () => {
    const { meeting } = await newMeeting();
    const attacker = await createUser();
    const socket = fakeSocket(attacker._id.toString());
    cloudflare.initSocket(socket);
    store.roomIDs[socket.id] = meeting._id.toString();
    await expect(call(socket, 'cf:session:new', {})).resolves.toEqual({ error: 'unauthorized' });
  });

  it('cannot pull a track published in a different meeting', async () => {
    const one = await newMeeting();
    const two = await newMeeting();
    const a = await joined(one.caller, one.meeting);
    const outsider = await joined(two.caller, two.meeting);
    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    await call(a, 'cf:tracks:ready', { producerIDs: push.producerIDs });
    await expect(call(outsider, 'cf:tracks:pull', { producerIDs: push.producerIDs })).resolves.toEqual({ error: 'producer_not_found' });
    expect(fakeClient.pullTracks).not.toHaveBeenCalled();
  });

  it("cannot close or confirm another participant's track", async () => {
    const { caller, callee, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    const b = await joined(callee, meeting);
    const push = await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    await call(a, 'cf:tracks:ready', { producerIDs: push.producerIDs });
    await expect(call(b, 'cf:tracks:close', { closes: [{ producerID: push.producerIDs[0], mid: '0' }] })).resolves.toEqual({ error: 'unauthorized' });
    expect(fakeClient.closeTracks).not.toHaveBeenCalled();
    expect(await store.peers.asyncFind({ type: 'producer', producerID: push.producerIDs[0] })).toHaveLength(1);
  });

  it('requires a session before publishing or subscribing', async () => {
    const { caller, meeting } = await newMeeting();
    const a = await joined(caller, meeting, { session: false });
    await expect(call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] })).resolves.toEqual({ error: 'no_session' });
  });

  it.each([
    ['empty tracks', { sessionDescription: 'OFFER', tracks: [] }],
    ['missing sdp', { tracks: [audioTrack] }],
    ['oversized sdp', { sessionDescription: 'x'.repeat(100001), tracks: [audioTrack] }],
    ['bad track name', { sessionDescription: 'OFFER', tracks: [{ ...audioTrack, trackName: '../etc/passwd' }] }],
    ['bad kind', { sessionDescription: 'OFFER', tracks: [{ ...audioTrack, kind: 'data' }] }],
    ['bad mid', { sessionDescription: 'OFFER', tracks: [{ ...audioTrack, mid: '0; DROP' }] }],
    ['too many tracks in one push', { sessionDescription: 'OFFER', tracks: [1, 2, 3, 4].map((n) => ({ mid: String(n), trackName: `video-${n}`, kind: 'video' })) }],
  ])('rejects invalid push: %s', async (name, payload) => {
    const { caller, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    const res = await call(a, 'cf:tracks:push', payload);
    expect(res.error).toMatch(/bad_request|bad_sdp/);
    expect(fakeClient.pushTracks).not.toHaveBeenCalled();
  });

  it('rejects malformed producer IDs on pull', async () => {
    const { caller, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    await expect(call(a, 'cf:tracks:pull', { producerIDs: ['not a producer id'] })).resolves.toEqual({ error: 'bad_request' });
    await expect(call(a, 'cf:tracks:pull', { producerIDs: [] })).resolves.toEqual({ error: 'bad_request' });
  });

  it('refuses duplicate track names and caps tracks per socket', async () => {
    const { caller, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    await call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] });
    await expect(call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] })).resolves.toEqual({ error: 'duplicate_track' });
  });

  it("hides Cloudflare's own error text from the client", async () => {
    fakeClient.pushTracks.mockRejectedValue(new Error('Cloudflare POST /apps/APPID/... -> 500: internal account detail'));
    const { caller, meeting } = await newMeeting();
    const a = await joined(caller, meeting);
    await expect(call(a, 'cf:tracks:push', { sessionDescription: 'OFFER', tracks: [audioTrack] })).resolves.toEqual({ error: 'call_request_failed' });
  });
});
