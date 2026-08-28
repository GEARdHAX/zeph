const User = require('../models/User');
const argon2 = require('argon2');
const validator = require('validator');
const xss = require('xss');
const { invalidateProfileCache } = require('../userProfileCache');

module.exports = async (req, res, next) => {
  let username = xss(req.fields.username);
  let email = xss(req.fields.email);
  let firstName = xss(req.fields.firstName);
  let lastName = xss(req.fields.lastName);
  let { password, repeatPassword, user } = req.fields;

  if (req.user.level !== 'root') return res.status(401).send('401 Unauthorized User');

  let errors = {};

  if (password !== repeatPassword) {
    errors.password = 'Passwords not matching';
    errors.repeatPassword = 'Passwords not matching';
  }

  !validator.isEmail(email) && (errors.email = 'Invalid email.');

  email = email.toLowerCase();

  const isUsername = await User.findOne({ usernameNormalized: username.toLowerCase() });
  if (isUsername && username.toLowerCase() !== user.username.toLowerCase()) errors.username = 'Username taken.';

  const isEmail = await User.findOne({ email });
  if (isEmail && email !== user.email) errors.email = 'Email already in use.';

  if (Object.keys(errors).length > 0) return res.status(400).json(errors);

  let query = {
    username: xss(username),
    usernameNormalized: xss(username).toLowerCase(),
    email: xss(email),
    firstName: xss(firstName),
    lastName: xss(lastName),
  };

  // The target's OLD username (from the request body's `user` field, the
  // pre-edit value the frontend already had loaded) — needed because the
  // cache key IS the username, so a change here (a root admin can rename
  // any account) moves the cached entry to a new key. See
  // change-username.js's identical old+new invalidation for the self-
  // service path.
  const previousUsernameNormalized = (user.username || '').toLowerCase();
  const respondWithInvalidation = async (updated) => {
    await Promise.all([
      invalidateProfileCache(previousUsernameNormalized),
      invalidateProfileCache(updated.usernameNormalized),
    ]);
    return updated;
  };

  if (typeof password === 'string' && password.length > 0) {
    argon2.hash(password).then((hash) => {
      query = { ...query, password: hash };
      User.findOneAndUpdate({ email }, { $set: query }, { new: true })
        .then(respondWithInvalidation)
        .then((updated) => res.status(200).json(updated));
    });
  } else {
    User.findOneAndUpdate({ email }, { $set: query }, { new: true })
      .then(respondWithInvalidation)
      .then((updated) => res.status(200).json(updated));
  }
};
