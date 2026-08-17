const Relationship = require('../../models/Relationship');

// Mutual friends only — an accepted Relationship, from either direction.
// Distinct from friend-requests/list.js (pending, not yet mutual) and from
// search.js (the unrestricted global user directory).
module.exports = async (req, res, next) => {
  const relationships = await Relationship.find({
    status: 'accepted',
    $or: [{ requester: req.user.id }, { recipient: req.user.id }],
  })
    .populate({ path: 'requester', select: 'username firstName lastName tagLine picture', populate: { path: 'picture' } })
    .populate({ path: 'recipient', select: 'username firstName lastName tagLine picture', populate: { path: 'picture' } })
    .sort({ respondedAt: -1 });

  const friends = relationships.map((r) => {
    const isRequester = r.requester._id.toString() === req.user.id.toString();
    const other = isRequester ? r.recipient : r.requester;
    // Same field name search.js annotates results with, so both surfaces'
    // result cards can render a "Friends" badge without branching on source.
    return { ...other.toObject(), relationshipStatus: 'accepted' };
  });

  res.status(200).json({ users: friends });
};
