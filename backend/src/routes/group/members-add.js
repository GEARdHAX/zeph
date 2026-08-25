const Room = require('../../models/Room');
const User = require('../../models/User');
const GroupMember = require('../../models/GroupMember');
const groupPolicy = require('../../authorization/groupPolicy');
const broadcastToGroup = require('../../utils/broadcastToGroup');
const unhideConversationForUser = require('../../utils/unhideConversationForUser');
const logger = require('../../logger');

// Invite/add flow: authenticate -> verify actor membership+capability ->
// target exists -> admin-boundary gate (invite-time only, see
// groupPolicy.js) -> atomic upsert (handles duplicate/concurrent add) ->
// emit realtime update. See DECISIONS.md D-035.
module.exports = async (req, res) => {
  const { id, userId } = req.fields;
  const actorId = req.user.id;

  const room = await Room.findOne({ _id: id, isGroup: true }).catch(() => null);
  if (!room || room.disabledAt) return res.status(404).json({ error: true });

  const actorMembership = await groupPolicy.getMembership(room._id, actorId);
  if (!actorMembership) return res.status(404).json({ error: true });

  if (!groupPolicy.hasCapability(actorMembership.role, groupPolicy.Capabilities.ADD_MEMBER)) {
    logger.warn({ groupId: room._id, actorId, reason: 'missing_capability' }, 'group_unauthorized_access_attempt');
    return res.status(403).json({ error: true });
  }

  const target = await User.findById(userId).select('_id level');
  // Admin privacy boundary — invite-time gate only, does not apply to an
  // admin already legitimately a member (see groupPolicy.js, DECISIONS.md
  // D-034/D-035). Same anti-enumeration 404 as "target doesn't exist".
  if (!target || (groupPolicy.isPrivileged(target) && !groupPolicy.isPrivileged(req.user))) {
    return res.status(404).json({ error: true });
  }

  // A ban must never be bypassable, including by a direct add — same rule
  // as group/invites/join.js and join-requests/create.js. See DECISIONS.md.
  if (await groupPolicy.isBanned(room._id, target._id)) {
    return res.status(403).json({ error: true, reason: 'BANNED' });
  }

  // Atomic upsert — the actual concurrency-safety mechanism for duplicate/
  // concurrent add requests, backed by GroupMember's unique {group,user}
  // index. Re-adding an already-active member is an idempotent no-op.
  // status is set to ACTIVE alongside active so the two fields never
  // disagree afterward, see GroupMember.js.
  let membership;
  let wasNew = false;
  try {
    const before = await GroupMember.findOne({ group: room._id, user: target._id });
    membership = await GroupMember.findOneAndUpdate(
      { group: room._id, user: target._id },
      {
        $setOnInsert: {
          role: 'MEMBER', joinedAt: new Date(), joinedVia: 'ADDED', invitedBy: actorId,
        },
        $set: { active: true, status: 'ACTIVE', updatedAt: new Date() },
      },
      { upsert: true, new: true },
    );
    wasNew = !before || !before.active;
  } catch (err) {
    if (err.code === 11000) {
      membership = await GroupMember.findOne({ group: room._id, user: target._id });
    } else {
      logger.error({ err, groupId: room._id, actorId }, 'Failed to add group member');
      return res.status(500).json({ error: true });
    }
  }

  if (wasNew) {
    await Room.updateOne({ _id: room._id }, { $addToSet: { people: target._id } });
    await unhideConversationForUser(room._id, target._id);
    logger.info({ groupId: room._id, actorId, targetId: target._id }, 'group_member_added');
    // room.people is the pre-add list — the newly-added user is included
    // explicitly since they aren't in it yet.
    broadcastToGroup([...room.people, target._id], 'group:member:added', {
      groupId: room._id, userId: target._id, role: membership.role,
    }, { excludeUserId: actorId });
  }

  res.status(200).json({ status: 'success', member: { user: target._id, role: membership.role } });
};
