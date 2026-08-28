const User = require('../../models/User');
const xss = require('xss');
const { invalidateProfileCache } = require('../../userProfileCache');

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

// Self-service — username doubles as this app's only user-facing identifier
// (profile links, mentions, search), so this is the "change my id" feature.
module.exports = async (req, res) => {
  const username = xss((req.fields.username || '').trim());

  if (!USERNAME_PATTERN.test(username)) {
    return res.status(400).json({ error: true, reason: 'invalid_format' });
  }

  const usernameNormalized = username.toLowerCase();
  const existing = await User.findOne({ usernameNormalized });
  if (existing && existing._id.toString() !== req.user.id.toString()) {
    return res.status(409).json({ error: true, reason: 'username_taken' });
  }

  // The cache key IS the username, so a change moves the caller's cached
  // profile to a new key entirely — both the old (now-stale, would
  // otherwise linger until its TTL) and new (never yet cached, no-op if
  // absent) keys need invalidating. req.user still holds the pre-update
  // value here (fetched fresh per-request by the JWT auth middleware).
  const previousUsernameNormalized = req.user.usernameNormalized;

  try {
    const updated = await User.findOneAndUpdate(
      { _id: req.user.id },
      { $set: { username, usernameNormalized } },
      { new: true },
    ).select('-email -password -friends -__v -vaultPinHash');
    await Promise.all([
      invalidateProfileCache(previousUsernameNormalized),
      invalidateProfileCache(usernameNormalized),
    ]);
    res.status(200).json({ status: 'success', user: updated });
  } catch (err) {
    // Unique index on usernameNormalized — a concurrent request claiming
    // the same username lands here as a race the pre-check above couldn't
    // fully close.
    if (err.code === 11000) return res.status(409).json({ error: true, reason: 'username_taken' });
    throw err;
  }
};
