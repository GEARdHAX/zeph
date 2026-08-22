const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const store = require('../store');

// Called at app boot (frontend/src/init.js) to check whether a locally
// stored token is still valid, before any Authorization header exists to
// hang passport.authenticate() off of — this route IS the auth check, not
// a route behind one. It used to trust a client-supplied raw `id` and
// return the full raw User document (password hash, email, vaultPinHash
// included) to anyone who guessed/knew a user's _id — a severe unauthenticated
// full-document leak that would have made every other admin-privacy-boundary
// fix pointless, since this route bypassed all of them. Fixed by verifying
// the actual JWT server-side (signature + expiry + session revocation,
// exactly like the passport-jwt strategy does) instead of trusting a bare id,
// and by returning only a minimal {valid: true} shape — never the document.
module.exports = async (req, res) => {
  const { token } = req.fields;
  if (!token || typeof token !== 'string') {
    return res.status(200).json({ error: true });
  }

  jwt.verify(token, store.config.secret, async (err, decoded) => {
    if (err) return res.status(200).json({ error: true });

    try {
      const user = await User.findById(decoded.id);
      if (!user) return res.status(200).json({ error: true });

      if (decoded.deviceId) {
        const session = await Session.findById(decoded.deviceId);
        if (!session || session.revokedAt) return res.status(200).json({ error: true });
      }

      return res.status(200).json({ valid: true });
    } catch (e) {
      return res.status(200).json({ error: true });
    }
  });
};
