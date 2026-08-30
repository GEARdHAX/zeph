const ThreatIndicator = require('../../models/ThreatIndicator');
const { isPrivileged } = require('../../authorization/policy');
const { normalizeIndicator } = require('../../services/threatIntel/indicators');

// GET /api/security/threat-intelligence/:indicator — manual lookup (spec
// section 29), the "inspect an indicator" admin capability. Looks up the
// PERSISTED record (ThreatIndicator) rather than triggering a fresh
// provider call — an admin inspecting history should never itself become
// a mechanism for spending threat-intel quota (that's threatIntelService's
// own lookup(), used by the actual security pipeline, not this read-only
// admin view).
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const raw = req.params.indicator;
  const normalized = normalizeIndicator(raw);
  if (!normalized) return res.status(400).json({ error: true, reason: 'INVALID_INDICATOR' });

  const indicator = await ThreatIndicator.findOne({
    normalizedIndicator: normalized.normalized, type: normalized.type,
  }).lean();

  if (!indicator) return res.status(404).json({ error: true, reason: 'NOT_FOUND' });

  res.status(200).json({ indicator });
};
