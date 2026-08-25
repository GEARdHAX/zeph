const crypto = require('crypto');

// Opaque, cryptographically secure invite token. Only the sha256 hash is
// ever persisted (FriendInvite.tokenHash / GroupInvite.tokenHash) — the raw
// token exists only in the URL handed back to the client, never logged,
// never stored.
const generateToken = () => crypto.randomBytes(24).toString('base64url');

const hashToken = (rawToken) => crypto.createHash('sha256').update(rawToken).digest('hex');

module.exports = { generateToken, hashToken };
