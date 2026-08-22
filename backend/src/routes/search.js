const User = require('../models/User');
const Relationship = require('../models/Relationship');
const { isPrivileged } = require('../authorization/policy');
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

  // Admin privacy boundary: a standard caller's search can never surface a
  // privileged account, at the query level (not filtered after the fact) —
  // see DECISIONS.md. A privileged caller (the admin console reuses this
  // same route, per that decision) gets the unfiltered query so admins can
  // still find/manage everyone, including each other.
  const matchConditions = [
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
  ];
  if (!isPrivileged(req.user)) {
    matchConditions.push({ level: 'standard' });
  }

  User.aggregate()
    .project({
      fullName: { $concat: ['$firstName', ' ', '$lastName'] },
      firstName: 1,
      lastName: 1,
      username: 1,
      email: 1,
      picture: 1,
      tagLine: 1,
      level: 1,
    })
    .match({ $and: matchConditions })
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
          const withRelationship = (!rel || rel.status === 'blocked')
            ? { ...u, relationshipStatus: null }
            : {
              ...u,
              relationshipStatus: rel.status,
              relationshipDirection: rel.requester.toString() === req.user.id.toString() ? 'outgoing' : 'incoming',
            };

          // `level` was only projected through for the boundary/console use
          // above — never send it to a non-privileged caller as a side
          // channel, even though the query already excludes privileged rows.
          if (!isPrivileged(req.user)) delete withRelationship.level;
          return withRelationship;
        });

        res.status(200).json({ limit, search, users: annotated });
      });
    });
};
