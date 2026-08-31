const SecurityIncident = require('../../models/SecurityIncident');
const { isPrivileged } = require('../../authorization/policy');

module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const incident = await SecurityIncident.findOne({ incidentId: req.params.incidentId }).lean();
  if (!incident) return res.status(404).json({ error: true, reason: 'INCIDENT_NOT_FOUND' });

  res.status(200).json({ incident });
};
