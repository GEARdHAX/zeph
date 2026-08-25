const Room = require('../../../models/Room');
const GroupInvite = require('../../../models/GroupInvite');
const groupPolicy = require('../../../authorization/groupPolicy');
const logger = require('../../../logger');
const { generateToken, hashToken } = require('../../../lib/inviteToken');

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

module.exports = async (req, res) => {
  const { groupId, maxUses } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: groupId, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const membership = await groupPolicy.getMembershipWithFallback(room._id, actorId);
  if (!membership) return res.status(404).json({ error: true });

  if (!groupPolicy.hasCapability(membership.role, groupPolicy.Capabilities.CREATE_INVITE)) {
    logger.warn({ groupId: room._id, actorId, reason: 'missing_capability' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  const parsedMaxUses = Number.parseInt(maxUses, 10);

  const rawToken = generateToken();
  await GroupInvite.create({
    group: room._id,
    creator: actorId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + EXPIRY_MS),
    maxUses: Number.isInteger(parsedMaxUses) && parsedMaxUses > 0 ? parsedMaxUses : null,
  });

  logger.info({ groupId: room._id, actorId }, 'invite.created');
  res.status(200).json({ url: `/invite/g/${rawToken}` });
};
