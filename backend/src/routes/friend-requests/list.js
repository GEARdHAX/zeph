const Relationship = require('../../models/Relationship');

module.exports = async (req, res, next) => {
  const incoming = await Relationship.find({ recipient: req.user.id, status: 'pending' })
    .populate({ path: 'requester', select: 'username firstName lastName picture', populate: { path: 'picture' } })
    .sort({ createdAt: -1 });

  const outgoing = await Relationship.find({ requester: req.user.id, status: 'pending' })
    .populate({ path: 'recipient', select: 'username firstName lastName picture', populate: { path: 'picture' } })
    .sort({ createdAt: -1 });

  res.status(200).json({ incoming, outgoing });
};
