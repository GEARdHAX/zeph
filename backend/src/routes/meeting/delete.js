const Meeting = require('../../models/Meeting');
const MeetingUserState = require('../../models/MeetingUserState');
const logger = require('../../logger');

// Per-user history delete — never removes the Meeting document itself (it
// may still be visible to other past participants), and never touches an
// active meeting (peers.length > 0 means someone is currently in the call —
// deleting a live call out of your history would be misleading, and could
// mask an ongoing call you're still able to rejoin).
module.exports = async (req, res) => {
  const { meetingId } = req.fields;
  const userID = req.user.id;

  if (!meetingId) {
    return res.status(400).json({ status: 'error' });
  }

  let meeting;
  try {
    meeting = await Meeting.findOne({ _id: meetingId });
  } catch (e) {
    return res.status(404).json({ status: 'error' });
  }
  if (!meeting) {
    return res.status(404).json({ status: 'error' });
  }

  const isParticipant = meeting.users.some((u) => u.toString() === userID.toString())
    || (meeting.caller && meeting.caller.toString() === userID.toString())
    || (meeting.callee && meeting.callee.toString() === userID.toString());
  if (!isParticipant) {
    return res.status(403).json({ status: 'error' });
  }

  if ((meeting.peers || []).length > 0) {
    return res.status(400).json({ status: 'error', reason: 'meeting_active' });
  }

  try {
    await MeetingUserState.findOneAndUpdate(
      { meeting: meetingId, user: userID },
      { $set: { deletedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    logger.error({ err, userId: userID, meetingId }, 'Failed to delete meeting from history');
    return res.status(500).json({ status: 'error' });
  }

  logger.info({ userId: userID, meetingId }, 'Meeting deleted from history (per-user)');

  res.status(200).json({ status: 'success', meetingId });
};
