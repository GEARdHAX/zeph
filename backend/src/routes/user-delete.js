const User = require('../models/User');
const cleanupDeletedUser = require('../utils/cleanupDeletedUser');
const store = require('../store');
const validator = require('validator');
const isEmpty = require('../utils/isEmpty');
const xss = require('xss');
const logger = require('../logger');

module.exports = async (req, res, next) => {
  let email = xss(req.fields.email);

  if (req.user.level !== 'root') return res.status(401).send('401 Unauthorized User');

  let errors = {};
  isEmpty(email) && (errors.email = 'Email required.');
  !validator.isEmail(email) && (errors.email = 'Invalid email.');
  if (Object.keys(errors).length > 0) return res.status(400).json(errors);

  email = email.toLowerCase();

  const result = await User.findOneAndDelete({ email });
  if (!result) return res.status(404).json({ email: 'User not found.' });

  try {
    await cleanupDeletedUser(result._id);
  } catch (err) {
    // The account is already gone at this point — a cleanup failure must
    // never look like the deletion itself failed to the caller. Logged for
    // follow-up; worst case a stale room/relationship lingers, which is the
    // pre-existing behavior this change is fixing, not a new failure mode.
    logger.error({ err, deletedUserId: result._id }, 'Failed to clean up data for deleted user');
  }

  logger.info({ deletedUserId: result._id, byUserId: req.user.id }, 'User deleted by admin');
  store.io.to(result._id.toString()).emit('user-deleted', { id: result._id });
  res.status(200).json({ result });
};
