const FriendInvite = require('../../../models/FriendInvite');
const Relationship = require('../../../models/Relationship');
const store = require('../../../store');
const logger = require('../../../logger');
const { findRelationship } = require('../../../authorization/policy');
const { hashToken } = require('../../../lib/inviteToken');

module.exports = async (req, res) => {
  const { token } = req.params;
  const accepterId = req.user.id;

  // Atomic claim: findOneAndUpdate with usedAt:null in the filter closes the
  // TOCTOU window a separate find-then-update would leave — two concurrent
  // accepts on the same token can only ever have one winner.
  const invite = await FriendInvite.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: null },
    { $set: { usedAt: new Date(), usedBy: accepterId } },
    { new: false },
  );
  if (!invite) return res.status(404).json({ error: true, reason: 'INVITE_NOT_FOUND' });

  if (invite.inviter.toString() === accepterId.toString()) {
    return res.status(400).json({ error: true, reason: 'SELF_INVITE' });
  }

  const existing = await findRelationship(invite.inviter, accepterId);
  if (existing && existing.status === 'accepted') {
    return res.status(409).json({ error: true, reason: 'ALREADY_FRIENDS' });
  }
  if (existing && existing.status === 'blocked') {
    return res.status(403).json({ error: true, reason: 'blocked' });
  }

  let relationship;
  try {
    if (existing) {
      existing.requester = invite.inviter;
      existing.recipient = accepterId;
      existing.status = 'accepted';
      existing.respondedAt = new Date();
      relationship = await existing.save();
    } else {
      relationship = await new Relationship({
        requester: invite.inviter, recipient: accepterId, status: 'accepted', respondedAt: new Date(),
      }).save();
    }
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: true, reason: 'ALREADY_FRIENDS' });
    }
    logger.error({ err, userId: accepterId }, 'Failed to accept friend invite');
    return res.status(500).json({ error: true });
  }

  logger.info({ inviterId: invite.inviter, accepterId }, 'invite.accepted');

  // Notify the inviter's connected sockets — the accepter already sees the
  // result via this request's own response, no self-emit needed.
  const sockets = store.socketsByUserID[invite.inviter.toString()] || [];
  sockets.forEach((socket) => socket.emit('friend:added', { relationshipId: relationship._id, userId: accepterId }));

  res.status(200).json({ relationship: { _id: relationship._id, status: relationship.status } });
};
