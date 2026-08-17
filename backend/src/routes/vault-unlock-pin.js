const argon2 = require('argon2');
const User = require('../models/User');
const { signVaultToken } = require('../vault/vaultToken');
const logger = require('../logger');

module.exports = async (req, res) => {
  const { pin } = req.fields;

  if (!pin) {
    return res.status(400).json({ status: 'error' });
  }

  let user;
  try {
    user = await User.findById(req.user.id);
  } catch (e) {
    return res.status(500).json({ status: 'error' });
  }

  // Same generic 401 whether the vault isn't set up at all or the PIN is
  // simply wrong — distinguishing the two would let a client enumerate
  // which accounts have a vault configured.
  if (!user || !user.vaultPinHash) {
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  let correct;
  try {
    correct = await argon2.verify(user.vaultPinHash, String(pin));
  } catch (e) {
    correct = false;
  }

  if (!correct) {
    logger.info({ userId: req.user.id }, 'Vault PIN unlock failed');
    return res.status(401).json({ status: 'error', reason: 'vault_locked' });
  }

  logger.info({ userId: req.user.id }, 'Vault unlocked via PIN');

  res.status(200).json({ status: 'success', vaultToken: signVaultToken(req.user.id) });
};
