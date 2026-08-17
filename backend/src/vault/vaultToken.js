const jwt = require('jsonwebtoken');
const store = require('../store');

// Short-lived, purpose-scoped step-up token — not a second auth system.
// Signed with the exact same secret/library as the main login JWT
// (routes/login.js); the only thing that makes it a "vault token" is the
// `purpose` claim, and it can never grant anything beyond re-proving "this
// already-authenticated user recently unlocked their vault." Ownership is
// re-checked against req.user.id on every use (see requireVaultAuth below),
// so a stolen vault token can't be replayed against a different account.
const VAULT_PURPOSE = 'vault';

const signVaultToken = (userID) => jwt.sign(
  { id: userID.toString(), purpose: VAULT_PURPOSE },
  store.config.secret,
  { expiresIn: store.config.vaultTokenTtl },
);

// Sent as a separate X-Vault-Token header, not Authorization — the frontend's
// axios.defaults.headers.common.Authorization slot is already permanently
// owned by the main login JWT (see actions/setAuthToken.js), so a second
// credential needs its own header rather than fighting over that slot.
const requireVaultAuth = (req, res, next) => {
  const token = req.headers['x-vault-token'];
  if (!token) {
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, store.config.secret);
  } catch (e) {
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  if (decoded.purpose !== VAULT_PURPOSE || decoded.id !== req.user.id.toString()) {
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  next();
};

// Non-throwing check used by routes that only need to *know* whether this
// request carries a currently-valid vault token (e.g. to decide if a hidden
// room may be read) without unconditionally requiring one — most callers of
// this (join-room, get-room, more-messages, sync-messages) also serve
// perfectly normal, non-hidden rooms with no vault token present at all.
const hasValidVaultToken = (req) => {
  const token = req.headers['x-vault-token'];
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, store.config.secret);
    return decoded.purpose === VAULT_PURPOSE && decoded.id === req.user.id.toString();
  } catch (e) {
    return false;
  }
};

module.exports = {
  signVaultToken, requireVaultAuth, hasValidVaultToken, VAULT_PURPOSE,
};
