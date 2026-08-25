const GroupInvite = require('../../../models/GroupInvite');
const Room = require('../../../models/Room');
const logger = require('../../../logger');
const { hashToken } = require('../../../lib/inviteToken');

// Unauthenticated — anyone with the link/QR can preview before logging in.
// No member list, no messages, no settings — just enough to decide to join.
module.exports = async (req, res) => {
  const { token } = req.params;

  const invite = await GroupInvite.findOne({ tokenHash: hashToken(token), revokedAt: null });
  if (!invite) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    return res.status(404).json({ error: true, reason: 'INVITE_LIMIT_REACHED' });
  }

  const room = await Room.findOne({ _id: invite.group, isGroup: true })
    .select('title picture people privacy disabledAt')
    .populate([{ path: 'picture', strictPopulate: false }])
    .catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true, reason: 'GROUP_NOT_FOUND' });

  logger.info({ groupId: room._id }, 'invite.previewed');
  res.status(200).json({
    group: {
      name: room.title,
      avatar: room.picture,
      memberCount: room.people.length,
      privacy: room.privacy,
    },
  });
};
