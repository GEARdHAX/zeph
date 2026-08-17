const User = require('../../models/User');
const Relationship = require('../../models/Relationship');

// Profile resolution for the Add People flow: username -> public profile +
// current relationship state with the caller. Never returns email/password/
// phone — only what a search result / profile preview needs to render.
module.exports = async (req, res, next) => {
  const { username } = req.params;
  if (!username || typeof username !== 'string') return res.status(400).json({ error: true });

  const user = await User.findOne({ usernameNormalized: username.toLowerCase() })
    .select('username firstName lastName tagLine picture discoveryEnabled')
    .populate({ path: 'picture', strictPopulate: false });

  // 404 (not 403) for both "doesn't exist" and "exists but discovery is off" —
  // a distinguishable response would let an attacker enumerate which
  // usernames are real even when the owner has opted out of discovery.
  if (!user || (user.discoveryEnabled === false && user._id.toString() !== req.user.id.toString())) {
    return res.status(404).json({ error: true });
  }

  let relationship = null;
  if (user._id.toString() !== req.user.id.toString()) {
    const existing = await Relationship.findOne({
      $or: [
        { requester: req.user.id, recipient: user._id },
        { requester: user._id, recipient: req.user.id },
      ],
    });
    if (existing && existing.status === 'blocked') {
      // Don't leak which side did the blocking or the underlying request
      // history that the block overwrote — the profile just becomes
      // unavailable, same as if no relationship existed at all.
      relationship = { status: 'blocked', direction: null };
    } else if (existing) {
      relationship = {
        _id: existing._id,
        status: existing.status,
        direction: existing.requester.toString() === req.user.id.toString() ? 'outgoing' : 'incoming',
      };
    }
  }

  res.status(200).json({
    user: {
      _id: user._id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      tagLine: user.tagLine,
      picture: user.picture,
    },
    relationship,
  });
};
