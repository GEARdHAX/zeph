const User = require('../models/User');
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
    .exec((err, users) => {
      if (err) return res.status(500).json({ error: true });
      User.populate(users, { path: 'picture' }, (err, users) => {
        if (err) return res.status(500).json({ error: true });
        res.status(200).json({ limit, search, users });
      });
    });
};
