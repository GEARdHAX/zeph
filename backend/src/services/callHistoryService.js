// Call Timeline / Call History — the business logic behind the per-user
// call history feature (Meeting = shared object, MeetingParticipant = who
// actually joined, CallSession = one connection period, CallTimelineEvent =
// meaningful events within it; MeetingSummary/MeetingTranscript stays
// completely separate — ONE summary per meeting, never touched here).
//
// Called exclusively from mediasoup/index.js's 'join' handler and
// leaveRoom() — the two points the backend has already confirmed a real
// connection (socket authorized + joined the Socket.IO room) or a real
// disconnection (explicit leave OR the 'disconnect' event, which already
// covers browser/tab close, network drop, and server-side socket kill —
// see leaveRoom's own comment for why one function already handles every
// disconnect path). This module never trusts anything the CLIENT claims
// about connection state (spec §4/§20) — every call site here already has
// the socket's authenticated userId and the server's own clock.
const crypto = require('crypto');
const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const MeetingParticipant = require('../models/MeetingParticipant');
const CallSession = require('../models/CallSession');
const CallTimelineEvent = require('../models/CallTimelineEvent');
const callHistoryRedis = require('./callHistoryRedis');
const logger = require('../logger');

const toObjectId = (id) => (mongoose.Types.ObjectId.isValid(id) ? mongoose.Types.ObjectId(id) : id);

// Upserts the participant identity — atomic, idempotent no matter how many
// times a user joins/reconnects. $setOnInsert means joinedAt is written
// ONLY the very first time this (meeting, user) pair is ever seen; every
// later call updates nothing but the shared `updatedAt` housekeeping field,
// which is harmless to repeat.
const upsertParticipant = async (meetingId, userId, connectedAt) =>
  MeetingParticipant.findOneAndUpdate(
    { meeting: meetingId, user: userId },
    { $setOnInsert: { meeting: meetingId, user: userId, joinedAt: connectedAt }, $set: { updatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

// Records CONNECTED — called from mediasoup/index.js's 'join' handler AFTER
// authorization + socket.join() have both already succeeded, i.e. the
// backend-confirmed point of connection (spec §4), never merely "the
// frontend attempted to join."
//
// Idempotent against a duplicate 'join' for the same socket: CallSession is
// looked up/created keyed by socketId, and Socket.IO guarantees socket.id
// uniqueness for the life of that connection, so a second call with the
// same socketId either finds nothing to duplicate (if the first call's
// session is still ACTIVE, this just returns it) or is a genuinely new
// connection (a fresh socket.id after a real reconnect) — never both.
const recordConnected = async ({ meetingId, userId, socketId, requestId = crypto.randomUUID() }) => {
  const existingForSocket = await CallSession.findOne({ socketId, status: 'ACTIVE' });
  if (existingForSocket) return existingForSocket; // duplicate CONNECTED for the same socket — no-op, not a new session

  const connectedAt = new Date();

  // Reconnect detection: has this user ever had a session for this meeting
  // before (regardless of status)? If so, this is a RECONNECTED event on
  // top of the CONNECTED one, not a first-time join.
  const hadPriorSession = await CallSession.exists({ meeting: meetingId, user: userId });

  await upsertParticipant(meetingId, userId, connectedAt);

  const session = await CallSession.create({
    meeting: meetingId,
    user: userId,
    socketId,
    connectedAt,
    status: 'ACTIVE',
  });

  await CallTimelineEvent.create({
    meeting: meetingId,
    user: userId,
    session: session._id,
    eventType: 'CONNECTED',
    timestamp: connectedAt,
  });

  logger.info(
    { requestId, meetingId: meetingId.toString(), userId: userId.toString(), sessionId: session._id.toString() },
    'call_session_created',
  );

  // Best-effort heartbeat (spec §14) — a stale-session detector for a
  // crashed process, not the source of truth; see callHistoryRedis.js.
  callHistoryRedis.setActiveCall(meetingId, userId, session._id).catch(() => {});

  if (hadPriorSession) {
    await CallTimelineEvent.create({
      meeting: meetingId,
      user: userId,
      session: session._id,
      eventType: 'RECONNECTED',
      timestamp: connectedAt,
    });
    logger.info(
      { requestId, meetingId: meetingId.toString(), userId: userId.toString(), sessionId: session._id.toString() },
      'call_reconnected',
    );
  }

  return session;
};

// Records DISCONNECTED for whichever session this socketId owns — called
// from leaveRoom() (shared by explicit 'leave' AND the 'disconnect' event,
// see that function's own comment), so this single code path already
// covers every disconnect scenario the spec lists (§5): explicit leave,
// socket disconnect, tab close, network drop, server-side kill. "Meeting
// ended" is not a distinct disconnect path here — it's a consequence of the
// LAST participant's ordinary disconnect (mediasoup/index.js already
// computes stillHasParticipants for Meeting.endedAt; disconnectReason
// below just borrows that same signal).
//
// Idempotent against a duplicate DISCONNECTED (leave firing, then the
// 'disconnect' event ALSO firing for the same closing socket): the
// findOneAndUpdate query requires status:'ACTIVE', so the second call
// matches nothing and no-ops (returns null) rather than double-closing or
// creating a second DISCONNECTED event.
const recordDisconnected = async ({ socketId, reason = 'left', requestId = crypto.randomUUID() }) => {
  const disconnectedAt = new Date();

  const session = await CallSession.findOneAndUpdate(
    { socketId, status: 'ACTIVE' },
    [
      {
        $set: {
          status: 'CLOSED',
          disconnectedAt,
          disconnectReason: reason,
          durationSeconds: { $divide: [{ $subtract: [disconnectedAt, '$connectedAt'] }, 1000] },
          updatedAt: disconnectedAt,
        },
      },
    ],
    { new: true },
  );
  if (!session) return null; // no ACTIVE session for this socket — duplicate disconnect, already closed, or never connected

  await CallTimelineEvent.create({
    meeting: session.meeting,
    user: session.user,
    session: session._id,
    eventType: 'DISCONNECTED',
    timestamp: disconnectedAt,
    metadata: { reason },
  });

  await MeetingParticipant.updateOne(
    { meeting: session.meeting, user: session.user },
    { $set: { leftAt: disconnectedAt, updatedAt: disconnectedAt } },
  );

  logger.info(
    {
      requestId,
      meetingId: session.meeting.toString(),
      userId: session.user.toString(),
      sessionId: session._id.toString(),
      durationSeconds: session.durationSeconds,
    },
    'call_session_closed',
  );

  callHistoryRedis.clearActiveCall(session.meeting, session.user).catch(() => {});

  return session;
};

// Dynamic duration for a still-open session (spec §7: "avoid constantly
// updating duration in the database" — computed on read, not persisted
// until the session actually closes).
const sessionDuration = (session) => {
  if (session.durationSeconds !== null && session.durationSeconds !== undefined) return session.durationSeconds;
  if (session.status !== 'ACTIVE') return null;
  return Math.max(0, (Date.now() - new Date(session.connectedAt).getTime()) / 1000);
};

module.exports = {
  recordConnected,
  recordDisconnected,
  sessionDuration,
  toObjectId,
};
