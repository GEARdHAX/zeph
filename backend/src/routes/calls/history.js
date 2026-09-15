const mongoose = require('mongoose');
const Meeting = require('../../models/Meeting');
const MeetingParticipant = require('../../models/MeetingParticipant');
const CallSession = require('../../models/CallSession');
const CallTimelineEvent = require('../../models/CallTimelineEvent');
const { sessionDuration } = require('../../services/callHistoryService');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Call Timeline / Call History (spec §9). GET /api/calls/history — the
// CURRENT user's own participation history, one entry per meeting they
// were ever a MeetingParticipant in, each with every CallSession + the
// full CallTimelineEvent list for that meeting.
//
// userId comes ONLY from req.user.id (the JWT) — never from a query param
// or the request body (spec §12: "never trust userId from the client for
// personal history authorization"). There is deliberately no
// GET /api/users/:userId/call-history route.
//
// Cursor pagination on MeetingParticipant.joinedAt, same _id/timestamp
// cursor idiom as routes/security/events-list.js. An optional ?meetingId=
// narrows to a single meeting — used by the frontend's per-meeting Call
// Timeline popup (CallTimelinePopup.jsx) instead of a separate endpoint;
// authorization is unchanged either way (still just "this user's own
// MeetingParticipant rows", scoped further by an extra query filter, never
// a different trust boundary).
module.exports = async (req, res) => {
  const { cursor, limit: limitParam, meetingId } = req.query;

  let limit = Number(limitParam) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const query = { user: req.user.id };
  if (meetingId) {
    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ error: true, reason: 'INVALID_MEETING_ID' });
    }
    query.meeting = meetingId;
  }
  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (Number.isNaN(parsedCursor.getTime())) return res.status(400).json({ error: true, reason: 'INVALID_CURSOR' });
    query.joinedAt = { $lt: parsedCursor };
  }

  const participations = await MeetingParticipant.find(query).sort({ joinedAt: -1 }).limit(limit).lean();
  if (participations.length === 0) return res.status(200).json({ history: [], cursor: null, limit });

  const meetingIds = participations.map((p) => p.meeting);

  const [meetings, sessions, events] = await Promise.all([
    Meeting.find({ _id: { $in: meetingIds } })
      .select('title startedAt endedAt')
      .lean(),
    // Only THIS user's own sessions/events for these meetings — another
    // participant's sessions are never fetched here at all, not merely
    // filtered out client-side.
    CallSession.find({ meeting: { $in: meetingIds }, user: req.user.id }).sort({ connectedAt: 1 }).lean(),
    CallTimelineEvent.find({ meeting: { $in: meetingIds }, user: req.user.id }).sort({ timestamp: 1 }).lean(),
  ]);

  const meetingById = new Map(meetings.map((m) => [m._id.toString(), m]));
  const sessionsByMeeting = new Map();
  sessions.forEach((s) => {
    const key = s.meeting.toString();
    if (!sessionsByMeeting.has(key)) sessionsByMeeting.set(key, []);
    sessionsByMeeting.get(key).push(s);
  });
  const eventsByMeeting = new Map();
  events.forEach((e) => {
    const key = e.meeting.toString();
    if (!eventsByMeeting.has(key)) eventsByMeeting.set(key, []);
    eventsByMeeting.get(key).push(e);
  });

  const history = participations.map((participation) => {
    const meetingId = participation.meeting.toString();
    const meeting = meetingById.get(meetingId);
    const meetingSessions = sessionsByMeeting.get(meetingId) || [];
    const meetingEvents = eventsByMeeting.get(meetingId) || [];

    const totalDurationSeconds = meetingSessions.reduce((sum, s) => sum + (sessionDuration(s) || 0), 0);

    return {
      meetingId,
      title: meeting?.title || null,
      startedAt: meeting?.startedAt || null,
      endedAt: meeting?.endedAt || null,
      joinedAt: participation.joinedAt,
      leftAt: participation.leftAt,
      totalDurationSeconds,
      sessions: meetingSessions.map((s) => ({
        connectedAt: s.connectedAt,
        disconnectedAt: s.disconnectedAt,
        durationSeconds: sessionDuration(s),
        disconnectReason: s.disconnectReason,
        status: s.status,
      })),
      timeline: meetingEvents.map((e) => ({
        eventType: e.eventType,
        timestamp: e.timestamp,
        metadata: e.metadata || {},
      })),
    };
  });

  const nextCursor =
    participations.length === limit ? participations[participations.length - 1].joinedAt.toISOString() : null;

  res.status(200).json({ history, cursor: nextCursor, limit });
};
