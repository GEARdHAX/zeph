const Meeting = require('../../models/Meeting');
const MeetingUserState = require('../../models/MeetingUserState');
const MeetingTranscript = require('../../models/MeetingTranscript');
const CallSession = require('../../models/CallSession');
const { sessionDuration } = require('../../services/callHistoryService');

module.exports = async (req, res, next) => {
  let { limit } = req.fields;

  !limit && (limit = 30);

  const deletedStates = await MeetingUserState.find({ user: req.user.id, deletedAt: { $ne: null } });
  const excludedIds = deletedStates.map((s) => s.meeting);

  Meeting.find({
    $or: [{ users: { $in: [req.user.id] } }, { caller: req.user.id }, { callee: req.user.id }],
    _id: { $nin: excludedIds },
  })
    .sort({ lastEnter: -1 })
    .populate({
      path: 'users',
      select: '-email -password -friends -__v -vaultPinHash',
      populate: {
        path: 'picture',
      },
    })
    .populate([{ path: 'caller', strictPopulate: false }])
    .populate([{ path: 'callee', strictPopulate: false }])
    .populate('group')
    .limit(limit)
    .lean()
    .exec(async (err, meetings) => {
      if (err) return res.status(500).json({ error: true });

      // Meeting-summary-persistence pass: attach lightweight availability
      // metadata (never the summary TEXT itself — spec section 5 explicitly
      // wants the list endpoint cheap; a click on "Summary" fetches the
      // real content via the existing GET /meeting/:id/summary). One query
      // for every listed meeting's transcript status, not N+1.
      const transcripts = await MeetingTranscript.find({ meeting: { $in: meetings.map((m) => m._id) } })
        .select('meeting status')
        .lean()
        .catch(() => []);
      const statusByMeeting = new Map(transcripts.map((t) => [t.meeting.toString(), t.status]));

      // Call Timeline / Call History (spec §19) — a lightweight per-meeting
      // "your participation" rollup for the CURRENT user only (their own
      // CallSessions, never another participant's). One query for every
      // listed meeting, same batched-not-N+1 shape as the summary lookup
      // above. Detailed per-session timeline stays behind GET
      // /api/calls/history / the on-demand timeline popup — this is just
      // enough for the card itself (spec §19: "do not clutter the card").
      const mySessions = await CallSession.find({
        meeting: { $in: meetings.map((m) => m._id) },
        user: req.user.id,
      })
        .select('meeting connectedAt disconnectedAt durationSeconds status')
        .lean()
        .catch(() => []);
      const sessionsByMeeting = new Map();
      mySessions.forEach((s) => {
        const key = s.meeting.toString();
        if (!sessionsByMeeting.has(key)) sessionsByMeeting.set(key, []);
        sessionsByMeeting.get(key).push(s);
      });

      const meetingsWithSummary = meetings.map((meeting) => {
        const status = statusByMeeting.get(meeting._id.toString());
        const mine = sessionsByMeeting.get(meeting._id.toString());
        const withParticipation = mine
          ? {
              ...meeting,
              participation: {
                sessionCount: mine.length,
                totalDurationSeconds: mine.reduce((sum, s) => sum + (sessionDuration(s) || 0), 0),
              },
            }
          : meeting;
        // No transcript doc at all ("NOT_STARTED" in get-summary.js's
        // vocabulary) — no recording was ever generated/requested for this
        // meeting, so the card shows no Summary affordance at all rather
        // than a permanently-disabled one.
        if (!status) return withParticipation;
        return { ...withParticipation, summary: { available: status === 'SUMMARIZED', status } };
      });

      res.status(200).json({ limit, meetings: meetingsWithSummary });
    });
};
