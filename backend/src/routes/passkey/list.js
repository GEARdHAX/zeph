const PasskeyCredential = require('../../models/PasskeyCredential');

// GET /api/passkey/list — the current user's enrolled login passkeys.
// Never returns publicKey/counter; only what Settings needs to show a row.
module.exports = async (req, res) => {
  const creds = await PasskeyCredential.find({ user: req.user.id })
    .select('_id label transports createdAt lastUsedAt')
    .sort({ createdAt: -1 })
    .lean();
  res.status(200).json({ passkeys: creds });
};
