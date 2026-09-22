const MeetingInvite = require('../../../models/MeetingInvite');
const { loadAuthorizedMeeting } = require('../../../authorization/meetingInvitePolicy');
const logger = require('../../../logger');

// POST /api/meeting-invites/:inviteId/revoke — takes the DB id, not the raw
// token (unlike accept/preview), so the host's invite-management list never
// needs to re-display or resend the raw token just to let them kill it.
// Revoking only prevents FUTURE use — existing acceptances/participants are
// untouched (spec §15); this route never writes to Meeting.users or touches
// MeetingInviteAcceptance at all.
module.exports = async (req, res) => {
  const { inviteId } = req.params;
  const actorId = req.user.id;

  const invite = await MeetingInvite.findOne({ _id: inviteId, revokedAt: null }).catch(() => null);
  if (!invite) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });

  // Same eligibility set as create.js — any current participant may revoke
  // an invite for that meeting (Meeting has no HOST-only concept to narrow
  // this to, see meetingInvitePolicy.js), not only the invite's own creator.
  const { meeting, authorized } = await loadAuthorizedMeeting(invite.meeting, actorId);
  if (!meeting || !authorized) {
    logger.warn({ inviteId, actorId, reason: 'not_a_participant' }, 'meeting_invite_unauthorized_revoke_attempt');
    return res.status(403).json({ error: true });
  }

  invite.revokedAt = new Date();
  await invite.save();

  logger.info({ meetingId: invite.meeting, inviteId: invite._id, actorId }, 'meeting_invite_revoked');
  res.status(200).json({ status: 'success' });
};
