const User = require('../../models/User');
const Relationship = require('../../models/Relationship');
const logger = require('../../logger');

// Unblocking deletes the relationship row rather than trying to "restore"
// whatever state existed before the block — that prior state (e.g. a
// pending request) was already overwritten when the block happened, so
// there's nothing accurate to restore to. Both users go back to NONE; a
// fresh friend request can be sent if wanted.
module.exports = async (req, res, next) => {
  const { username } = req.fields;
  if (!username || typeof username !== 'string') return res.status(400).json({ error: true });

  const target = await User.findOne({ usernameNormalized: username.toLowerCase() }).select('_id');
  if (!target) return res.status(404).json({ error: true });

  try {
    const relationship = await Relationship.findOneAndDelete({
      status: 'blocked',
      blockedBy: req.user.id,
      $or: [
        { requester: req.user.id, recipient: target._id },
        { requester: target._id, recipient: req.user.id },
      ],
    });
    if (!relationship) return res.status(404).json({ error: true });

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'Failed to unblock user');
    res.status(500).json({ error: true });
  }
};
