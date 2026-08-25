const FriendInvite = require('../../../models/FriendInvite');
const User = require('../../../models/User');
const logger = require('../../../logger');
const { hashToken } = require('../../../lib/inviteToken');

// Unauthenticated — anyone with the link/QR can preview before logging in.
// Lightweight by design: only what's needed to decide whether to accept.
module.exports = async (req, res) => {
  const { token } = req.params;

  const invite = await FriendInvite.findOne({ tokenHash: hashToken(token), usedAt: null });
  if (!invite) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });

  const inviter = await User.findById(invite.inviter).select('username firstName lastName picture').populate('picture');
  if (!inviter) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });

  logger.info({ inviterId: invite.inviter }, 'invite.previewed');
  res.status(200).json({
    inviter: {
      username: inviter.username,
      firstName: inviter.firstName,
      lastName: inviter.lastName,
      picture: inviter.picture,
    },
  });
};
