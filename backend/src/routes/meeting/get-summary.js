const Meeting = require('../../models/Meeting');
const MeetingTranscript = require('../../models/MeetingTranscript');

// Zeph AI — Meeting AI. GET /api/meeting/:id/summary — polls the current
// transcript/summary status for a meeting (used by the frontend after a 202
// PROCESSING response from summarize.js, since BullMQ processing is
// asynchronous).
//
// Meeting-summary-persistence pass: authorization here is DELIBERATELY
// narrower than mediasoup/index.js's authorizeMeetingJoin (which also
// allows any CURRENT group member, so people can join a call happening in
// their group right now). A past meeting's SUMMARY is different — it must
// only be visible to people who actually attended THIS SPECIFIC meeting,
// not anyone who happens to currently be in the group. Meeting.users is an
// append-only set ($addToSet in mediasoup/index.js's join handler, never
// pruned on leave) recording every user who ever joined, so someone who
// joined for a single second and immediately left is still authorized —
// exactly the spec'd "C joined for 1s, still authorized; D never joined,
// denied" behavior. caller/callee cover 1:1 calls where the recipient may
// not have technically "joined" the mediasoup room but is still a rightful
// party to the call.
const authorizeSummaryAccess = (meeting, userId) => {
  const userIdStr = userId.toString();
  if (meeting.caller && meeting.caller.toString() === userIdStr) return true;
  if (meeting.callee && meeting.callee.toString() === userIdStr) return true;
  return (meeting.users || []).some((u) => u.toString() === userIdStr);
};

module.exports = async (req, res) => {
  const { id: meetingId } = req.params;

  const meeting = await Meeting.findById(meetingId).catch(() => null);
  if (!meeting) return res.status(404).json({ error: true });

  if (!authorizeSummaryAccess(meeting, req.user.id)) {
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
