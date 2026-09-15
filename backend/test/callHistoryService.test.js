// Call Timeline / Call History — the core lifecycle logic. This is where
// every idempotency/edge-case guarantee the feature promises actually
// lives (see callHistoryService.js's own module comment); the
// mediasoup/index.js call sites that invoke it are thin one-liners
// reviewed by inspection, same "test the real logic, not the call site"
// posture already used for authorizeMeetingJoin elsewhere in this suite.
const db = require('./helpers/db');
const User = require('../src/models/User');
const Meeting = require('../src/models/Meeting');
const MeetingParticipant = require('../src/models/MeetingParticipant');
const CallSession = require('../src/models/CallSession');
const CallTimelineEvent = require('../src/models/CallTimelineEvent');
const callHistoryService = require('../src/services/callHistoryService');

beforeAll(async () => {
  await db.connect();
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

const createMeeting = async (overrides = {}) => Meeting.create(overrides);

describe('recordConnected — a user successfully connects', () => {
  it('creates a MeetingParticipant, a CallSession, and a CONNECTED event', async () => {
    const user = await createUser();
    const meeting = await createMeeting();

    const session = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });

    expect(session.status).toBe('ACTIVE');
    expect(session.socketId).toBe('socket-1');

    const participant = await MeetingParticipant.findOne({ meeting: meeting._id, user: user._id });
    expect(participant).not.toBeNull();
    expect(participant.joinedAt).toBeInstanceOf(Date);
    expect(participant.leftAt).toBeNull();

    const events = await CallTimelineEvent.find({ session: session._id });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('CONNECTED');
  });

  it('a duplicate CONNECTED for the SAME socketId does not create a second active session', async () => {
    const user = await createUser();
    const meeting = await createMeeting();

    const first = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });
    const second = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });

    expect(second._id.toString()).toBe(first._id.toString());
    const sessions = await CallSession.find({ meeting: meeting._id, user: user._id });
    expect(sessions).toHaveLength(1);
    const events = await CallTimelineEvent.find({ meeting: meeting._id, user: user._id, eventType: 'CONNECTED' });
    expect(events).toHaveLength(1);
  });

  it('a user connected for only 1 second still gets a MeetingParticipant + CallSession + CONNECTED/DISCONNECTED', async () => {
    const user = await createUser();
    const meeting = await createMeeting();

    const session = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });
    await callHistoryService.recordDisconnected({ socketId: 'socket-1', reason: 'left' });

    const participant = await MeetingParticipant.findOne({ meeting: meeting._id, user: user._id });
    expect(participant).not.toBeNull();
    expect(participant.leftAt).not.toBeNull();

    const closed = await CallSession.findById(session._id);
    expect(closed.status).toBe('CLOSED');
    expect(closed.durationSeconds).not.toBeNull();

    const eventTypes = (await CallTimelineEvent.find({ session: session._id }).sort({ timestamp: 1 })).map(
      (e) => e.eventType,
    );
    expect(eventTypes).toEqual(['CONNECTED', 'DISCONNECTED']);
  });

  it('multiple sockets for the SAME user (multi-device/tab) get independent sessions', async () => {
    const user = await createUser();
    const meeting = await createMeeting();

    const tabA = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'tab-a',
    });
    const tabB = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'tab-b',
    });

    expect(tabA._id.toString()).not.toBe(tabB._id.toString());

    // Closing tab A must not affect tab B's session — spec §16.
    await callHistoryService.recordDisconnected({ socketId: 'tab-a', reason: 'left' });
    const stillOpen = await CallSession.findById(tabB._id);
    expect(stillOpen.status).toBe('ACTIVE');
    const closed = await CallSession.findById(tabA._id);
    expect(closed.status).toBe('CLOSED');
  });
});

describe('recordDisconnected — a user leaves', () => {
  it('closes the session, calculates duration from server timestamps, and creates a DISCONNECTED event', async () => {
    const user = await createUser();
    const meeting = await createMeeting();
    const session = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });
    // Backdate connectedAt so duration is deterministic and non-trivial.
    await CallSession.updateOne({ _id: session._id }, { connectedAt: new Date(Date.now() - 15000) });

    const closed = await callHistoryService.recordDisconnected({ socketId: 'socket-1', reason: 'network' });

    expect(closed.status).toBe('CLOSED');
    expect(closed.disconnectReason).toBe('network');
    expect(closed.durationSeconds).toBeGreaterThanOrEqual(14);
    expect(closed.durationSeconds).toBeLessThan(20);

    const event = await CallTimelineEvent.findOne({ session: session._id, eventType: 'DISCONNECTED' });
    expect(event.metadata.reason).toBe('network');
  });

  it('a duplicate DISCONNECTED for an already-closed session is a no-op (no double-closing logic)', async () => {
    const user = await createUser();
    const meeting = await createMeeting();
    await callHistoryService.recordConnected({ meetingId: meeting._id, userId: user._id, socketId: 'socket-1' });

    const first = await callHistoryService.recordDisconnected({ socketId: 'socket-1', reason: 'left' });
    const second = await callHistoryService.recordDisconnected({ socketId: 'socket-1', reason: 'left' });

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // nothing ACTIVE left to close

    const events = await CallTimelineEvent.find({
      meeting: meeting._id,
      user: user._id,
      eventType: 'DISCONNECTED',
    });
    expect(events).toHaveLength(1); // exactly one, not two
  });

  it('a disconnect for a socketId that never connected is a no-op', async () => {
    const result = await callHistoryService.recordDisconnected({ socketId: 'never-connected', reason: 'network' });
    expect(result).toBeNull();
  });
});

describe('Reconnect — spec §6 worked example', () => {
  it('a second connection after a disconnect creates a SECOND CallSession and a RECONNECTED event, preserving the first session', async () => {
    const user = await createUser();
    const meeting = await createMeeting();

    const session1 = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });
    await callHistoryService.recordDisconnected({ socketId: 'socket-1', reason: 'network' });

    // Reconnect = a NEW socket.id, same user+meeting (matches a real
    // browser reconnect, which opens a fresh Socket.IO connection).
    const session2 = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-2',
    });

    expect(session2._id.toString()).not.toBe(session1._id.toString());

    const allSessions = await CallSession.find({ meeting: meeting._id, user: user._id }).sort({ connectedAt: 1 });
    expect(allSessions).toHaveLength(2); // BOTH preserved — spec §2: "Do NOT overwrite the first session"
    expect(allSessions[0]._id.toString()).toBe(session1._id.toString());
    expect(allSessions[1]._id.toString()).toBe(session2._id.toString());

    const reconnectEvent = await CallTimelineEvent.findOne({ session: session2._id, eventType: 'RECONNECTED' });
    expect(reconnectEvent).not.toBeNull();

    // Only ONE MeetingParticipant identity — not a second one created by
    // the reconnect (spec §6: "DO NOT create a new MeetingParticipant
    // identity that destroys history").
    const participants = await MeetingParticipant.find({ meeting: meeting._id, user: user._id });
    expect(participants).toHaveLength(1);
  });

  it('the FIRST connection of a brand-new participation does NOT get a spurious RECONNECTED event', async () => {
    const user = await createUser();
    const meeting = await createMeeting();

    const session = await callHistoryService.recordConnected({
      meetingId: meeting._id,
      userId: user._id,
      socketId: 'socket-1',
    });

    const reconnectEvent = await CallTimelineEvent.findOne({ session: session._id, eventType: 'RECONNECTED' });
    expect(reconnectEvent).toBeNull();
  });
});

describe('sessionDuration', () => {
  it('returns the persisted duration for a closed session', () => {
    const closed = { status: 'CLOSED', durationSeconds: 42, connectedAt: new Date() };
    expect(callHistoryService.sessionDuration(closed)).toBe(42);
  });

  it('computes a live duration for a still-ACTIVE session without persisting it', () => {
    const active = { status: 'ACTIVE', durationSeconds: null, connectedAt: new Date(Date.now() - 5000) };
    const duration = callHistoryService.sessionDuration(active);
    expect(duration).toBeGreaterThanOrEqual(4);
    expect(duration).toBeLessThan(10);
  });
});
