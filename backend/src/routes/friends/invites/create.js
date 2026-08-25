const FriendInvite = require('../../../models/FriendInvite');
const logger = require('../../../logger');
const { generateToken, hashToken } = require('../../../lib/inviteToken');

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

module.exports = async (req, res) => {
  const rawToken = generateToken();

  await FriendInvite.create({
    inviter: req.user.id,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + EXPIRY_MS),
  });

  logger.info({ userId: req.user.id }, 'invite.created');
  res.status(200).json({ url: `/invite/f/${rawToken}` });
};
