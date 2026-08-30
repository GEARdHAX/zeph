const ThreatIndicator = require('../../models/ThreatIndicator');
const { isPrivileged } = require('../../authorization/policy');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
const VALID_TYPES = new Set(['IP', 'DOMAIN', 'URL', 'HASH']);
const VALID_SOURCES = new Set(['abuseipdb', 'mock', 'unknown']);

// Admin-only threat-indicator search API (Phase 3 spec section 28) — same
// pagination/RBAC/query-param conventions as security/events-list.js
// (Phase 1), deliberately copied rather than reinvented.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const {
    type, malicious, severity, source, cursor, limit: limitParam,
  } = req.query;

  let limit = Number(limitParam) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const query = {};
  if (type) {
    if (!VALID_TYPES.has(type)) return res.status(400).json({ error: true, reason: 'INVALID_TYPE' });
    query.type = type;
  }
  if (malicious !== undefined) {
    query.status = malicious === 'true' ? 'MALICIOUS' : { $ne: 'MALICIOUS' };
  }
  if (severity) {
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) return res.status(400).json({ error: true, reason: 'INVALID_SEVERITY' });
    query.severity = severity;
  }
  if (source) {
    if (!VALID_SOURCES.has(source)) return res.status(400).json({ error: true, reason: 'INVALID_SOURCE' });
    query.source = source;
  }
  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (Number.isNaN(parsedCursor.getTime())) return res.status(400).json({ error: true, reason: 'INVALID_CURSOR' });
    query.updatedAt = { $lt: parsedCursor };
  }

  const indicators = await ThreatIndicator.find(query)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  const nextCursor = indicators.length === limit ? indicators[indicators.length - 1].updatedAt.toISOString() : null;

  res.status(200).json({ indicators, cursor: nextCursor, limit });
};
