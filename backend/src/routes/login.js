const User = require('../models/User');
const argon2 = require('argon2');
const validator = require('validator');
const isEmpty = require('../utils/isEmpty');
const SecurityEventService = require('../services/securityEventService');
const securityEventContext = require('../utils/securityEventContext');
const issueSession = require('../lib/issueSession');

module.exports = (req, res, next) => {
  let { email, password } = req.fields;

  let errors = {};
  isEmpty(email) && (errors.email = 'Username (or email) required.');
  isEmpty(password) && (errors.password = 'Password required.');
  if (Object.keys(errors).length > 0) return res.status(400).json(errors);

  email = email.toLowerCase();
  const context = securityEventContext(req);

  const sendResponse = async (user) => {
    try {
      const token = await issueSession(user, req, { method: 'password' });
      res.status(200).json({ token });
    } catch (err) {
      res.status(500).json({ token: 'Error signing token.' });
    }
  };

  // Wrong-password branch — records the SAME LOGIN_FAILED type/severity as
  // the account-not-found branch above (spec section 12: telemetry must not
  // let a consumer distinguish "no such account" from "wrong password" even
  // though this route's own HTTP response already does, pre-existing
  // behavior this pass leaves untouched). reason lives only in metadata,
  // server-side, never in the HTTP response.
  const sendError = (reason) => {
    SecurityEventService.record({
      type: 'LOGIN_FAILED',
      severity: 'medium',
      source: context,
      target: { resource: '/api/login', action: 'login' },
      result: 'failure',
      metadata: { reason },
    });
    return res.status(400).json({ password: 'Wrong password.' });
  };

  let query;
  if (validator.isEmail(email)) query = { email };
  else query = { username: email };

  User.findOne(query)
    .populate([{ path: 'picture', strictPopulate: false }])
    .populate([{ path: 'endpoint', strictPopulate: false }])
    .then((user) => {
      if (!user) {
        // Response shape here (404/'User not found.') is unchanged,
        // pre-existing behavior — not something this telemetry pass should
        // silently fix. The LOGIN_FAILED event itself still uses the same
        // generic type/severity as a wrong-password failure below, so
        // anything CONSUMING these events (a future risk engine, an admin
        // viewer) can't distinguish the two either, even though the current
        // HTTP response already can.
        SecurityEventService.record({
          type: 'LOGIN_FAILED',
          severity: 'medium',
          source: context,
          target: { resource: '/api/login', action: 'login' },
          result: 'failure',
          metadata: { reason: 'account_not_found' },
        });
        return res.status(404).json({ email: 'User not found.' });
      }
      argon2.verify(user.password, password).then((correct) => {
        if (!correct) return sendError('bad_password');
        if (user.accountStatus === 'DEACTIVATED' || user.accountStatus === 'DELETED') {
          SecurityEventService.record({
            type: 'LOGIN_FAILED',
            severity: 'medium',
            actor: { userId: user._id },
            source: context,
            target: { resource: '/api/login', action: 'login' },
            result: 'blocked',
            metadata: { reason: 'account_suspended' },
          });
          return res.status(403).json({ email: 'This account has been suspended.' });
        }
        return sendResponse(user);
      });
    });
};
