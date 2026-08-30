const crypto = require('crypto');
const SensorCredential = require('../../models/SensorCredential');
const { isPrivileged } = require('../../authorization/policy');
const logger = require('../../logger');

// Admin-only sensor registration (spec sections 11-13) — mints a new
// sensorId+credential pair. The raw credential is returned EXACTLY ONCE,
// in this response, and never again — same one-time-reveal contract
// stepUp.js's issueStepUpToken already established for a different
// credential type in Phase 2.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { sensorId, hostId } = req.fields;
  if (!sensorId || !hostId) return res.status(400).json({ error: true, reason: 'sensorId_and_hostId_required' });

  const existing = await SensorCredential.findOne({ sensorId, revokedAt: null });
  if (existing) return res.status(409).json({ error: true, reason: 'sensor_already_registered' });

  const rawCredential = crypto.randomBytes(32).toString('base64url');
  await SensorCredential.create({
    sensorId, hostId, credentialHash: SensorCredential.hashCredential(rawCredential),
  });

  logger.info({ sensorId, hostId, adminId: req.user.id }, 'sensor_registered');

  res.status(201).json({
    status: 'success', sensorId, hostId, credential: rawCredential,
  });
};
