const User = require('../models/User');
const { isPrivileged } = require('../authorization/policy');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = (req, res, next) => {
  let { search, limit } = req.fields;

  !limit && (limit = 25);

  search = typeof search === 'string' ? search.slice(0, 100) : '';
  const safeSearch = escapeRegex(search);

  // Same admin-privacy-boundary and self-exclusion treatment as search.js —
  // see DECISIONS.md. Also fixes two pre-existing bugs found while touching
  // this file: `search` was interpolated straight into a regex (ReDoS /
  // regex-injection risk), and the self-exclusion filter was a dead
  // hardcoded literal ('TODO my email') that never matched anything.
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
    })
    .match({ $and: matchConditions })
    .sort({ _id: -1 })
    .limit(limit)
    .exec((err, users) => {
      User.populate(users, { path: 'picture' }, (err, users) => {
        if (err) return res.status(500).json({ status: 500 });
        res.status(200).json(users);
      });
    });
};
