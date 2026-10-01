const Meeting = require('../../models/Meeting');
const MeetingTranscript = require('../../models/MeetingTranscript');
const { isAuthorizedForMeetingHistory } = require('../../authorization/meetingInvitePolicy');

// Zeph AI — Meeting AI. GET /api/meeting/:id/summary — polls the current
// transcript/summary status for a meeting (used by the frontend after a 202
// PROCESSING response from summarize.js, since BullMQ processing is
// asynchronous).
//
// Authorization: a past meeting's SUMMARY must only be visible to people
// who actually attended THIS SPECIFIC meeting — see
// authorization/meetingInvitePolicy.js's isAuthorizedForMeetingHistory for
// the full reasoning (and the Phase 10 N1 bug this fixes: Meeting.users,
// used here previously, records invite-accept ELIGIBILITY, not actual
// attendance).
module.exports = async (req, res) => {
  const { id: meetingId } = req.params;

  const meeting = await Meeting.findById(meetingId).catch(() => null);
  if (!meeting) return res.status(404).json({ error: true });

  if (!(await isAuthorizedForMeetingHistory(meeting, req.user.id))) {
    return res.status(403).json({ error: true, reason: 'NOT_A_PARTICIPANT' });
  }

  const transcriptDoc = await MeetingTranscript.findOne({ meeting: meetingId }).lean();
  if (!transcriptDoc) return res.status(404).json({ error: true, status: 'NOT_STARTED' });

  res.status(200).json({
    status: transcriptDoc.status,
    summary: transcriptDoc.summary || null,
    failureReason: transcriptDoc.failureReason || null,
  });
};
