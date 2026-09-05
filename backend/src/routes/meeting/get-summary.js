const Meeting = require('../../models/Meeting');
const MeetingTranscript = require('../../models/MeetingTranscript');
const groupPolicy = require('../../authorization/groupPolicy');

// Zeph AI — Meeting AI. GET /api/meeting/:id/summary — polls the current
// transcript/summary status for a meeting (used by the frontend after a 202
// PROCESSING response from summarize.js, since BullMQ processing is
// asynchronous). Same authorization boundary as summarize.js.
const authorizeMeetingAccess = async (meeting, userId) => {
  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return true;
  if (meeting.callee && meeting.callee.toString() === userIdStr) return true;
  if ((meeting.users || []).some((u) => u.toString() === userIdStr)) return true;
  if (meeting.group) {
    const membership = await groupPolicy.getMembershipWithFallback(meeting.group, userIdStr);
    if (membership) return true;
  }
  return false;
};

module.exports = async (req, res) => {
  const { id: meetingId } = req.params;

  const meeting = await Meeting.findById(meetingId).catch(() => null);
  if (!meeting) return res.status(404).json({ error: true });

  const authorized = await authorizeMeetingAccess(meeting, req.user.id);
  if (!authorized) return res.status(403).json({ error: true });

  const transcriptDoc = await MeetingTranscript.findOne({ meeting: meetingId }).lean();
  if (!transcriptDoc) return res.status(404).json({ error: true, status: 'NOT_STARTED' });

  res.status(200).json({
    status: transcriptDoc.status,
    summary: transcriptDoc.summary || null,
    failureReason: transcriptDoc.failureReason || null,
  });
};
