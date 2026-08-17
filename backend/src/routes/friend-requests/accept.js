const Relationship = require('../../models/Relationship');
const logger = require('../../logger');

module.exports = async (req, res, next) => {
  const { id } = req.params;

  const relationship = await Relationship.findOne({ _id: id, recipient: req.user.id, status: 'pending' });
  if (!relationship) return res.status(404).json({ error: true });

  relationship.status = 'accepted';
  relationship.respondedAt = new Date();
  try {
    await relationship.save();
    res.status(200).json({ relationship: { _id: relationship._id, status: relationship.status } });
  } catch (err) {
    logger.error({ err, userId: req.user.id, relationshipId: id }, 'Failed to accept friend request');
    res.status(500).json({ error: true });
  }
};
