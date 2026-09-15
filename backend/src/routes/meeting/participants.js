const Meeting = require('../../models/Meeting');
const MeetingParticipant = require('../../models/MeetingParticipant');
const User = require('../../models/User');

// Call Timeline / Call History (spec §10). GET /api/meeting/:id/participants
// — a MEETING-scoped view for other participants (e.g. "who was in this
// call and when"), deliberately separate from GET /api/calls/history (the
// CURRENT user's own detailed per-session timeline). Same authorization
// boundary as get-summary.js: only people who actually attended THIS
// meeting may view its participant list at all — see that file's comment
// for the full reasoning (narrower than mediasoup's live-join check on
// purpose).
//
// Returns per-user joinedAt/leftAt ONLY — explicitly NOT session-level
// detail (reconnect count, exact connect/disconnect timestamps per
// session, disconnect reasons) and NOT any technical metadata (IP, device
// fingerprint, WebRTC diagnostics, socketId) — spec §10's explicit
// "unless there is an explicit product requirement," which this task
// doesn't state. A user's own full timeline (their own sessions/events)
// stays exclusively behind GET /api/calls/history, authenticated as
// themselves.
const authorizeParticipantsAccess = (meeting, userId) => {
  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return true;
  if (meeting.callee && meeting.callee.toString() === userIdStr) return true;
  return (meeting.users || []).some((u) => u.toString() === userIdStr);
};

module.exports = async (req, res) => {
  const { id: meetingId } = req.params;

  const meeting = await Meeting.findById(meetingId).catch(() => null);
  if (!meeting) return res.status(404).json({ error: true });

  if (!authorizeParticipantsAccess(meeting, req.user.id)) {
    return res.status(403).json({ error: true, reason: 'NOT_A_PARTICIPANT' });
  }

  const participants = await MeetingParticipant.find({ meeting: meetingId })
    .select('user joinedAt leftAt')
    .lean();

  const users = await User.find({ _id: { $in: participants.map((p) => p.user) } })
    .select('firstName lastName username picture')
    .populate({ path: 'picture', strictPopulate: false })
    .lean();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  res.status(200).json({
    participants: participants.map((p) => ({
      user: userById.get(p.user.toString()) || null,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
    })),
  });
};
