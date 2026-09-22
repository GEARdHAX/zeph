const MeetingInvite = require('../../../models/MeetingInvite');
const { loadAuthorizedMeeting } = require('../../../authorization/meetingInvitePolicy');

// GET /api/meetings/:meetingId/invites — management list for the host UI
// (spec §26). Never returns the raw token or tokenHash — a host who lost
// the copied link creates a new invite rather than recovering the old one,
// same as FriendInvite/GroupInvite have no "show me the token again" path.
const deriveStatus = (invite) => {
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return 'EXHAUSTED';
  return 'ACTIVE';
};

module.exports = async (req, res) => {
  const { meetingId } = req.params;
  const actorId = req.user.id;

  const { meeting, authorized } = await loadAuthorizedMeeting(meetingId, actorId);
  if (!meeting) return res.status(404).json({ error: true });
  if (!authorized) return res.status(403).json({ error: true });

  const invites = await MeetingInvite.find({ meeting: meeting._id }).sort({ createdAt: -1 }).limit(50).lean();

  res.status(200).json({
    invites: invites.map((invite) => ({
      inviteId: invite._id,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      useCount: invite.useCount,
      status: deriveStatus(invite),
    })),
  });
};
