const GroupInvite = require('../../../models/GroupInvite');
const groupPolicy = require('../../../authorization/groupPolicy');
const logger = require('../../../logger');
const { hashToken } = require('../../../lib/inviteToken');

// Revocation is authorized by group role at revoke-time (OWNER/ADMIN, or the
// invite's own creator), not by who created the invite alone — an ADMIN
// should be able to kill a MEMBER-created invite link.
module.exports = async (req, res) => {
  const { token } = req.params;
  const actorId = req.user.id;

  const invite = await GroupInvite.findOne({ tokenHash: hashToken(token), revokedAt: null });
  if (!invite) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });

  const membership = await groupPolicy.getMembershipWithFallback(invite.group, actorId);
  if (!membership) return res.status(404).json({ error: true });

  const isCreator = invite.creator.toString() === actorId.toString();
  const canManage = membership.role === groupPolicy.Roles.OWNER || membership.role === groupPolicy.Roles.ADMIN;
  if (!isCreator && !canManage) {
    return res.status(403).json({ error: true });
  }

  invite.revokedAt = new Date();
  await invite.save();

  logger.info({ groupId: invite.group, actorId }, 'invite.revoked');
  res.status(200).json({ status: 'success' });
};
