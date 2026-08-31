const argon2 = require('argon2');
const isEmpty = require('../../utils/isEmpty');
const User = require('../../models/User');
const Session = require('../../models/Session');

// Phase 9 audit finding: this route previously required no current-password
// verification at all (any request authenticated with a valid JWT could
// silently overwrite the account's password) and never revoked other
// sessions afterward. Zero Trust's ztChangePassword gate (routes/index.js)
// only demands step-up above a risk score of 50 (SENSITIVE tier,
// policies.js) — an attacker with a stolen JWT whose request looks
// low-risk (same IP/device the legitimate user already trusts, e.g. a
// token lifted via XSS on the victim's own browser) could change the
// password with zero proof of knowing it. Fixed to mirror the two
// established patterns already in this codebase: delete-account.js's
// current-password re-verification, and auth/change.js's (forgot-password
// flow) session revocation on a real password change. Scoped to OTHER
// sessions only (excluding req.user.deviceId, the caller's own current
// session) rather than auth/change.js's revoke-everything — the caller is
// demonstrably on a trusted, already-authenticated session right now,
// unlike a password-reset requester who isn't.
module.exports = async (req, res) => {
  const { password, currentPassword } = req.fields;

  let user;

  try {
    user = await User.findById(req.user.id);
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'database read error' });
  }

  if (!user) {
    return res.status(404).json({ status: 'error', message: 'user not found' });
  }

  if (!currentPassword || !(await argon2.verify(user.password, currentPassword))) {
    return res.status(403).json({ status: 'error', message: 'incorrect current password' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ status: 'error', password: 'password too short, must be at least 6 characters' });
  }

  if (!isEmpty(password)) user.password = await argon2.hash(password);

  try {
    await user.save();
  } catch (e) {
    return res.status(500).json({ status: 'error', message: 'database write error' });
  }

  const revokeFilter = { user: user._id, revokedAt: null };
  if (req.user.deviceId) revokeFilter._id = { $ne: req.user.deviceId };
  await Session.updateMany(revokeFilter, { $set: { revokedAt: new Date() } });

  user = await User.findById(req.user.id);

  res.status(200).json({ status: 'success', user });
};
