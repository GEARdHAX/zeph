const argon2 = require('argon2');
const User = require('../../models/User');
const Session = require('../../models/Session');
const cleanupDeletedUser = require('../../utils/cleanupDeletedUser');
const store = require('../../store');
const logger = require('../../logger');

// Self-service account deletion — password re-verification required (unlike
// admin hard-delete, which is already gated by the caller being root; here
// the caller IS the account being deleted, so a stolen/left-open session
// alone must not be enough). Reuses the exact same cleanup as the admin
// path (cleanupDeletedUser) so both routes leave identical, correct state
// behind. See DECISIONS.md.
module.exports = async (req, res) => {
  const { password } = req.fields;
  if (!password) return res.status(400).json({ error: true, reason: 'password_required' });

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: true });

  const correct = await argon2.verify(user.password, password);
  if (!correct) return res.status(403).json({ error: true, reason: 'incorrect_password' });

  await User.deleteOne({ _id: user._id });
  await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });

  try {
    await cleanupDeletedUser(user._id);
  } catch (err) {
    // Same reasoning as user-delete.js — the account is already gone,
    // a cleanup failure must never look like the deletion itself failed.
    logger.error({ err, deletedUserId: user._id }, 'Failed to clean up data for self-deleted user');
  }

  logger.info({ deletedUserId: user._id }, 'User deleted their own account');
  store.io.to(user._id.toString()).emit('user-deleted', { id: user._id });
  res.status(200).json({ status: 'success' });
};
