const User = require('../models/User');
const VaultCredential = require('../models/VaultCredential');

// Tells the client whether this user has a vault secret configured yet, so
// the UI can decide "first-time setup" vs. "unlock" without ever exposing
// the PIN hash itself or any credential material.
module.exports = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ status: 'error' });

  const hasPasskey = await VaultCredential.exists({ user: req.user.id });

  res.status(200).json({
    status: 'success',
    configured: !!user.vaultPinHash || !!hasPasskey,
    hasPin: !!user.vaultPinHash,
    hasPasskey: !!hasPasskey,
  });
};
