const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const store = require('../store');
const SecurityEventService = require('../services/securityEventService');

// Shared "this user is now authenticated — mint a device session + JWT"
// path, used by both password login (routes/login.js) and passwordless
// passkey login (routes/passkey/login-verify.js). Keeping it in one place
// means the JWT payload shape, session TTL and LOGIN_SUCCESS event stay
// identical no matter how the user proved who they are.
const issueSession = (user, req, { method } = {}) =>
  new Promise((resolve, reject) => {
    new Session({ user: user._id, userAgent: req.headers['user-agent'] || '' })
      .save()
      .then((session) => {
        const payload = {
          id: user._id,
          email: user.email,
          level: user.level,
          firstName: user.firstName,
          lastName: user.lastName,
          picture: user.picture,
          username: user.username,
          deviceId: session._id,
        };
        jwt.sign(payload, store.config.secret, { expiresIn: 60 * 60 * 24 * 60 }, (err, token) => {
          if (err) return reject(err);
          SecurityEventService.record({
            type: 'LOGIN_SUCCESS',
            severity: 'low',
            actor: { userId: user._id.toString(), sessionId: session._id.toString() },
            source: require('../utils/securityEventContext')(req),
            target: { resource: '/api/login', action: 'login' },
            result: 'success',
            metadata: method ? { method } : undefined,
          });
          return resolve(token);
        });
      })
      .catch(reject);
  });

module.exports = issueSession;
