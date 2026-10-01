const MeetingInvite = require('../../../models/MeetingInvite');
const { loadAuthorizedMeeting } = require('../../../authorization/meetingInvitePolicy');
const { generateToken, hashToken } = require('../../../lib/inviteToken');
const logger = require('../../../logger');

// Server-authoritative expiration options (spec §3) — the client sends a
// KEY from this map, never a raw timestamp/duration, so there is no
// "trust a client-provided arbitrary expiration timestamp" surface at all.
const EXPIRY_OPTIONS_MS = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};
const DEFAULT_EXPIRY_KEY = '1h';

module.exports = async (req, res) => {
  const { meetingId } = req.params;
  const { expiresIn, maxUses } = req.fields;
  const actorId = req.user.id;

  const { meeting, authorized } = await loadAuthorizedMeeting(meetingId, actorId);
  if (!meeting) return res.status(404).json({ error: true });
  if (!authorized) {
    logger.warn({ meetingId, actorId, reason: 'not_a_participant' }, 'meeting_invite_unauthorized_create_attempt');
    return res.status(403).json({ error: true });
  }

  // Audit finding (Phase 10, N2): creating a new invite to an already-ended
  // meeting was never blocked — closing this at the source, not just at
  // accept time (see accept.js's matching MEETING_ENDED check), so a stale
  // meeting never gets a fresh shareable link in the first place.
  if (meeting.endedAt) {
    logger.warn({ meetingId, actorId, reason: 'meeting_ended' }, 'meeting_invite_create_rejected');
    return res.status(410).json({ error: true, reason: 'MEETING_ENDED' });
  }

  const expiryKey = Object.prototype.hasOwnProperty.call(EXPIRY_OPTIONS_MS, expiresIn) ? expiresIn : DEFAULT_EXPIRY_KEY;
  const expiresAt = new Date(Date.now() + EXPIRY_OPTIONS_MS[expiryKey]);

  const parsedMaxUses = Number.parseInt(maxUses, 10);

  const rawToken = generateToken();
  const invite = await MeetingInvite.create({
    meeting: meeting._id,
    createdBy: actorId,
    tokenHash: hashToken(rawToken),
    expiresAt,
    maxUses: Number.isInteger(parsedMaxUses) && parsedMaxUses > 0 ? parsedMaxUses : null,
  });

  logger.info({ meetingId: meeting._id, actorId, inviteId: invite._id, expiryKey }, 'meeting_invite_created');
  res.status(200).json({
    inviteId: invite._id,
    url: `/invite/m/${rawToken}`,
    expiresAt: invite.expiresAt,
    status: 'ACTIVE',
  });
};

module.exports.EXPIRY_OPTIONS_MS = EXPIRY_OPTIONS_MS;
