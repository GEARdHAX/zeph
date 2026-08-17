const argon2 = require('argon2');
const User = require('../models/User');
const VaultCredential = require('../models/VaultCredential');
const { hasValidVaultToken } = require('../vault/vaultToken');

module.exports = async (req, res) => {
  const { pin } = req.fields;

  if (!pin || String(pin).length < 4 || String(pin).length > 12 || !/^\d+$/.test(String(pin))) {
    return res.status(400).json({ status: 'error', reason: 'invalid_pin' });
  }

  let user;
  try {
    user = await User.findById(req.user.id);
  } catch (e) {
    return res.status(500).json({ status: 'error' });
  }
  if (!user) {
    return res.status(404).json({ status: 'error' });
  }

  const vaultAlreadyExists = !!user.vaultPinHash || (await VaultCredential.exists({ user: req.user.id }));

  // First-ever setup (nothing configured yet) is reachable on the main JWT
  // alone — there's nothing to protect. Once a vault secret exists, changing
  // the PIN requires already being unlocked, so a stolen main JWT alone
  // can't silently overwrite a PIN the real user chose.
  if (vaultAlreadyExists && !hasValidVaultToken(req)) {
    return res.status(403).json({ status: 'error', reason: 'vault_locked' });
  }

  user.vaultPinHash = await argon2.hash(String(pin));

  try {
    await user.save();
  } catch (e) {
    return res.status(500).json({ status: 'error' });
  }

  res.status(200).json({ status: 'success' });
};
