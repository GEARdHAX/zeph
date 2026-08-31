const SecurityIncident = require('../../models/SecurityIncident');
const { isPrivileged } = require('../../authorization/policy');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

// Admin-only incident listing (spec section 47) — same cursor-pagination/
// RBAC conventions as threat-intelligence-list.js/events-list.js,
// deliberately copied rather than reinvented.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { severity, anomalous, cursor, limit: limitParam } = req.query;

  let limit = Number(limitParam) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const query = {};
  if (severity) {
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) return res.status(400).json({ error: true, reason: 'INVALID_SEVERITY' });
    query.severity = severity;
  }
  if (anomalous !== undefined) {
    query['aiAnalysis.anomalous'] = anomalous === 'true';
  }
  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (Number.isNaN(parsedCursor.getTime())) return res.status(400).json({ error: true, reason: 'INVALID_CURSOR' });
    query.lastSeenAt = { $lt: parsedCursor };
  }

  const incidents = await SecurityIncident.find(query)
    .sort({ lastSeenAt: -1 })
    .limit(limit)
    .lean();

  const nextCursor = incidents.length === limit ? incidents[incidents.length - 1].lastSeenAt.toISOString() : null;

  res.status(200).json({ incidents, cursor: nextCursor, limit });
};
