const User = require('../../models/User');
const Relationship = require('../../models/Relationship');
const store = require('../../store');
const logger = require('../../logger');
const {
  authorizeAction, Actions, Decisions, findRelationship, isPrivileged,
} = require('../../authorization/policy');

module.exports = async (req, res, next) => {
  const { username } = req.fields;
  if (!username || typeof username !== 'string') return res.status(400).json({ error: true });

  const recipient = await User.findOne({ usernameNormalized: username.toLowerCase() })
    .select('_id discoveryEnabled level');
  // Admin privacy boundary — same generic 404 as "doesn't exist" / "discovery
  // off", checked before authorizeAction so a privileged target never even
  // reaches the relationship lookup. See DECISIONS.md.
  if (!recipient
    || recipient.discoveryEnabled === false
    || (isPrivileged(recipient) && !isPrivileged(req.user))) {
    return res.status(404).json({ error: true });
  }

  const authz = await authorizeAction({
    actor: req.user.id,
    target: recipient._id,
    action: Actions.SEND_FRIEND_REQUEST,
    actorLevel: req.user.level,
    targetLevel: recipient.level,
  });
  if (authz.decision !== Decisions.ALLOW) {
    const status = authz.reason === 'blocked' ? 403 : 400;
    return res.status(status).json({ error: true, reason: authz.reason });
  }

  const existing = await findRelationship(req.user.id, recipient._id);
  // A declined request can be re-sent later (Instagram-style: decline resets
  // to "Add Friend", not a permanent dead end) — reuse the row rather than
  // insert a second one, since the unique index is one row per direction.
  // Any other existing status (pending/accepted/blocked) is a real conflict.
  if (existing && existing.status !== 'declined') {
    return res.status(409).json({ error: true, status: existing.status });
  }

  try {
    let relationship;
    if (existing) {
      existing.requester = req.user.id;
      existing.recipient = recipient._id;
      existing.status = 'pending';
      existing.respondedAt = null;
      relationship = await existing.save();
    } else {
      relationship = await new Relationship({ requester: req.user.id, recipient: recipient._id }).save();
    }
    // Realtime nudge for the recipient — previously nothing told the other
    // side a request arrived; they only ever saw it by opening Notifications
    // and re-fetching (getFriendRequests runs once on mount, see
    // NotificationsPlaceholder.jsx). Same store.io.to(personId) idiom as
    // message.js/broadcastToGroup.js. Public fields only, same select shape
    // friend-requests/list.js already returns for this exact card.
    User.findById(req.user.id)
      .select('username firstName lastName picture')
      .populate('picture')
      .then((requester) => {
        store.io.to(recipient._id.toString()).emit('friend-request:received', {
          relationship: { _id: relationship._id, status: relationship.status },
          requester,
        });
      })
      .catch((err) => logger.warn({ err, userId: req.user.id }, 'Failed to emit friend-request:received'));
    res.status(200).json({ relationship: { _id: relationship._id, status: relationship.status } });
  } catch (err) {
    // Unique index on {requester, recipient} — a concurrent duplicate request
    // lands here as a race the pre-check above couldn't fully close.
    if (err.code === 11000) return res.status(409).json({ error: true });
    logger.error({ err, userId: req.user.id }, 'Failed to create friend request');
    res.status(500).json({ error: true });
  }
};
