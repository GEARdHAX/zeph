const User = require('../models/User');
const Relationship = require('../models/Relationship');
Config = require('../../config');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = (req, res, next) => {
  let { search, limit } = req.fields;

  search = typeof search === 'string' ? search.slice(0, 100) : '';

  limit = Number(limit) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const safeSearch = escapeRegex(search);

  User.aggregate()
    .project({
      fullName: { $concat: ['$firstName', ' ', '$lastName'] },
      firstName: 1,
      lastName: 1,
      username: 1,
      email: 1,
      picture: 1,
      tagLine: 1,
    })
    .match({
      $and: [
        {
          $or: [
            { fullName: { $regex: safeSearch, $options: 'i' } },
            { email: { $regex: safeSearch, $options: 'i' } },
            { username: { $regex: safeSearch, $options: 'i' } },
            { firstName: { $regex: safeSearch, $options: 'i' } },
            { lastName: { $regex: safeSearch, $options: 'i' } },
          ],
        },
        {
          email: { $ne: req.user.email },
        },
      ],
    })
    .sort({ _id: -1 })
    .limit(limit)
    .exec(async (err, users) => {
      if (err) return res.status(500).json({ error: true });
      User.populate(users, { path: 'picture' }, async (err, users) => {
        if (err) return res.status(500).json({ error: true });

        // Batch-load every relationship touching these results in one query
        // (not one lookup per row) so search cards can show a "Friends" /
        // "Requested" badge without an extra round-trip per result.
        const userIds = users.map((u) => u._id);
        const relationships = await Relationship.find({
          $or: [
            { requester: req.user.id, recipient: { $in: userIds } },
            { requester: { $in: userIds }, recipient: req.user.id },
          ],
        });

        // users here are plain objects (aggregate() results), not Mongoose
        // documents — no .toObject() needed or available.
        const annotated = users.map((u) => {
          const rel = relationships.find(
            (r) => r.requester.toString() === u._id.toString() || r.recipient.toString() === u._id.toString(),
          );
          if (!rel || rel.status === 'blocked') {
            return { ...u, relationshipStatus: null };
          }
          return {
            ...u,
            relationshipStatus: rel.status,
            relationshipDirection: rel.requester.toString() === req.user.id.toString() ? 'outgoing' : 'incoming',
          };
        });

        res.status(200).json({ limit, search, users: annotated });
      });
    });
};
