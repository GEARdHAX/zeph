const User = require('../../models/User');
const Relationship = require('../../models/Relationship');
const { findRelationship } = require('../../authorization/policy');
const logger = require('../../logger');

// Blocking always wins over any prior state, so no authorizeAction() gate
// here beyond "not yourself" — you can block a stranger, a pending request,
// an accepted contact, or a room you already share, unconditionally.
module.exports = async (req, res, next) => {
  const { username } = req.fields;
  if (!username || typeof username !== 'string') return res.status(400).json({ error: true });

  const target = await User.findOne({ usernameNormalized: username.toLowerCase() }).select('_id');
  if (!target) return res.status(404).json({ error: true });
  if (target._id.toString() === req.user.id.toString()) return res.status(400).json({ error: true });

  try {
    let relationship = await findRelationship(req.user.id, target._id);
    if (relationship) {
      relationship.status = 'blocked';
      relationship.blockedBy = req.user.id;
      relationship.respondedAt = new Date();
      await relationship.save();
    } else {
      relationship = await new Relationship({
        requester: req.user.id,
        recipient: target._id,
        status: 'blocked',
        blockedBy: req.user.id,
        respondedAt: new Date(),
      }).save();
    }

    res.status(200).json({ relationship: { _id: relationship._id, status: relationship.status } });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'Failed to block user');
    res.status(500).json({ error: true });
  }
};
