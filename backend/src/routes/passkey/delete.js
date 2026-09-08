const PasskeyCredential = require('../../models/PasskeyCredential');
const logger = require('../../logger');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');

// POST /api/passkey/:id/delete — remove one of your own login passkeys.
// The { user: req.user.id } filter is the IDOR guard: you can only ever
// delete a row that is yours, regardless of the :id supplied.
module.exports = async (req, res) => {
  const { id } = req.params;
  const result = await PasskeyCredential.deleteOne({ _id: id, user: req.user.id }).catch(() => null);
  if (!result || result.deletedCount === 0) return res.status(404).json({ error: true });

  SecurityEventService.record({
    type: 'DEVICE_REGISTERED',
    severity: 'low',
    actor: { userId: req.user.id.toString() },
    source: securityEventContext(req),
    target: { resource: '/api/passkey', resourceId: id, action: 'passkey_remove' },
    result: 'success',
  });

  logger.info({ userId: req.user.id, credentialId: id }, 'login passkey removed');
  res.status(200).json({ status: 'success' });
};
