const User = require('../models/User');
const logger = require('../logger');

module.exports = (req, res, next) => {
  let { imageID } = req.fields;

  logger.info({ userId: req.user.id }, 'Changing profile picture');

  User.findOneAndUpdate({ _id: req.user.id }, { $set: { picture: imageID } }, { new: true })
    .populate([{ path: 'picture', strictPopulate: false }])
    .exec((err, user) => {
      if (err) return res.status(500).json({ error: true });
      res.status(200).json(user.picture);
    });
};
