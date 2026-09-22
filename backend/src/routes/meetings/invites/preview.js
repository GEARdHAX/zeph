const MeetingInvite = require('../../../models/MeetingInvite');
const Meeting = require('../../../models/Meeting');
const User = require('../../../models/User');
const { hashToken } = require('../../../lib/inviteToken');
const logger = require('../../../logger');

// Unauthenticated — same contract as friends/invites/preview.js and
// group/invites/preview.js: enough to render a safe "you're invited"
// screen, never enough to reveal meeting content. Does NOT add the caller
// to the meeting — see accept.js for the only write path.
module.exports = async (req, res) => {
  const { token } = req.params;

  const invite = await MeetingInvite.findOne({ tokenHash: hashToken(token), revokedAt: null });
  if (!invite) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });

  // Explicit expiry check — never rely solely on the TTL index's background
  // sweep (runs ~once/minute, not synchronously), see MeetingInvite.js.
  if (invite.expiresAt.getTime() <= Date.now()) {
    return res.status(404).json({ error: true, reason: 'INVITE_EXPIRED' });
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    return res.status(404).json({ error: true, reason: 'INVITE_EXHAUSTED' });
  }

  const meeting = await Meeting.findById(invite.meeting).select('title').catch(() => null);
  if (!meeting) return res.status(404).json({ error: true, reason: 'MEETING_NOT_FOUND' });

  const inviter = await User.findById(invite.createdBy).select('firstName lastName username');
  const inviterName = inviter
    ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.username
    : null;

  logger.info({ meetingId: meeting._id, inviteId: invite._id }, 'meeting_invite_previewed');
  res.status(200).json({
    status: 'ACTIVE',
    expiresAt: invite.expiresAt,
    meeting: {
      id: meeting._id,
      // Falls back to a generic label rather than exposing nothing — the
      // spec's own example shows a real title, but Meeting.title is
      // optional (see Meeting.js) and this must never leak participant
      // identities or any other meeting content pre-authentication.
      title: meeting.title || 'Zeph meeting',
    },
    invitedBy: inviterName,
  });
};
