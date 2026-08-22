const User = require('../../models/User');
const Relationship = require('../../models/Relationship');
const GroupMember = require('../../models/GroupMember');
const Room = require('../../models/Room');
const { isPrivileged } = require('../../authorization/policy');

// Profile resolution for the Add People flow AND the universal profile
// viewer: username -> public profile + current relationship state with the
// caller. Never returns email/password/phone — only what a profile view
// needs to render.
module.exports = async (req, res, next) => {
  const { username } = req.params;
  if (!username || typeof username !== 'string') return res.status(400).json({ error: true });

  const user = await User.findOne({ usernameNormalized: username.toLowerCase() })
    .select('username firstName lastName tagLine bio picture discoveryEnabled level')
    .populate({ path: 'picture', strictPopulate: false });

  const isSelf = user && user._id.toString() === req.user.id.toString();

  // 404 (not 403) for "doesn't exist", "discovery is off", AND "target is a
  // privileged account viewed by a non-privileged caller" — a distinguishable
  // response for any of these would let an attacker enumerate which
  // usernames are real/privileged. See DECISIONS.md.
  if (!user
    || (user.discoveryEnabled === false && !isSelf)
    || (isPrivileged(user) && !isSelf && !isPrivileged(req.user))) {
    return res.status(404).json({ error: true });
  }

  let relationship = null;
  let commonGroups = [];
  if (!isSelf) {
    const existing = await Relationship.findOne({
      $or: [
        { requester: req.user.id, recipient: user._id },
        { requester: user._id, recipient: req.user.id },
      ],
    });
    if (existing && existing.status === 'blocked') {
      // Don't leak which side did the blocking or the underlying request
      // history that the block overwrote — the profile just becomes
      // unavailable, same as if no relationship existed at all. Common
      // groups/friends-since stay suppressed too, same posture.
      relationship = { status: 'blocked', direction: null };
    } else {
      if (existing) {
        relationship = {
          _id: existing._id,
          status: existing.status,
          direction: existing.requester.toString() === req.user.id.toString() ? 'outgoing' : 'incoming',
          // "Friends since" is when the request was ACCEPTED, not when it was
          // sent (createdAt) — respondedAt is set by friend-requests/accept.js.
          respondedAt: existing.status === 'accepted' ? existing.respondedAt : undefined,
        };
      }

      // Both users' active group memberships, intersected — no existing
      // helper covers a two-user intersection (groupPolicy.js's lookups are
      // single-user/single-group), so this is a small dedicated query
      // against the same GroupMember collection every other group
      // authorization check already reads from.
      const memberships = await GroupMember.find({
        user: { $in: [req.user.id, user._id] },
        active: true,
      }).select('group user');
      const groupCounts = new Map();
      memberships.forEach((m) => {
        const groupId = m.group.toString();
        groupCounts.set(groupId, (groupCounts.get(groupId) || 0) + 1);
      });
      const commonGroupIds = [...groupCounts.entries()]
        .filter(([, count]) => count === 2)
        .map(([groupId]) => groupId)
        .slice(0, 20);

      if (commonGroupIds.length) {
        const rooms = await Room.find({ _id: { $in: commonGroupIds } })
          .select('title picture')
          .populate({ path: 'picture', strictPopulate: false });
        commonGroups = rooms.map((room) => ({
          _id: room._id, title: room.title, picture: room.picture,
        }));
      }
    }
  }

  res.status(200).json({
    user: {
      _id: user._id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      tagLine: user.tagLine,
      bio: user.bio,
      picture: user.picture,
    },
    relationship,
    commonGroups,
  });
};
