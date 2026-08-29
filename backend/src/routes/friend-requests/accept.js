const Relationship = require('../../models/Relationship');
const User = require('../../models/User');
const store = require('../../store');
const logger = require('../../logger');

module.exports = async (req, res, next) => {
  const { id } = req.params;

  const relationship = await Relationship.findOne({ _id: id, recipient: req.user.id, status: 'pending' });
  if (!relationship) return res.status(404).json({ error: true });

  relationship.status = 'accepted';
  relationship.respondedAt = new Date();
  try {
    await relationship.save();
    // Tell the original requester in realtime — without this they only find
    // out by re-opening the now-friend's profile or noticing a DM appear.
    // Same store.io.to(personId) idiom as friend-requests/send.js.
    User.findById(req.user.id)
      .select('username firstName lastName picture')
      .populate('picture')
      .then((accepter) => {
        store.io.to(relationship.requester.toString()).emit('friend-request:accepted', {
          relationship: { _id: relationship._id, status: relationship.status },
          accepter,
        });
      })
      .catch((err) => logger.warn({ err, userId: req.user.id }, 'Failed to emit friend-request:accepted'));
    res.status(200).json({ relationship: { _id: relationship._id, status: relationship.status } });
  } catch (err) {
    logger.error({ err, userId: req.user.id, relationshipId: id }, 'Failed to accept friend request');
    res.status(500).json({ error: true });
  }
};
