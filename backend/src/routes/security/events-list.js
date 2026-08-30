const SecurityEvent = require('../../models/SecurityEvent');
const { isPrivileged } = require('../../authorization/policy');
const { SecurityEventTypes, SecurityEventSeverities, SecurityEventResults } = require('../../constants/securityEventTypes');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

const VALID_TYPES = new Set(Object.values(SecurityEventTypes));

// Admin-only security-event listing (spec section 17) — cursor pagination,
// same _id-based idiom as group/members-list.js. GET with query params
// (this is a read, unlike almost every other route in this app which is
// POST-with-req.fields — a query API is the one place that convention
// doesn't fit; see routes/index.js's existing GET routes for precedent:
// /sessions, /friends, /users/:username all already do this).
module.exports = async (req, res) => {
  // Ordinary users must never reach this at all — not even a 403 that
  // confirms the route exists, same "don't leak more than necessary" spirit
  // as the admin-privacy-boundary 404s elsewhere in this codebase. Every
  // user's own security events (their own login history etc.) are not
  // exposed to that user in Phase 1 either — spec section 21: "Allow users
  // to query other users' security events" is explicitly forbidden, and
  // there's no existing "my own events" self-service endpoint to build
  // that safely within this pass's scope.
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const {
    type, severity, userId, ip, startDate, endDate, result, cursor, limit: limitParam,
  } = req.query;

  let limit = Number(limitParam) || DEFAULT_LIMIT;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const query = {};

  if (type) {
    if (!VALID_TYPES.has(type)) return res.status(400).json({ error: true, reason: 'INVALID_TYPE' });
    query.type = type;
  }
  if (severity) {
    if (!SecurityEventSeverities.includes(severity)) return res.status(400).json({ error: true, reason: 'INVALID_SEVERITY' });
    query.severity = severity;
  }
  if (result) {
    if (!SecurityEventResults.includes(result)) return res.status(400).json({ error: true, reason: 'INVALID_RESULT' });
    query.result = result;
  }
  if (userId) query['actor.userId'] = userId;
  if (ip) query['source.ip'] = ip;
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) {
      const parsed = new Date(startDate);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: true, reason: 'INVALID_START_DATE' });
      query.timestamp.$gte = parsed;
    }
    if (endDate) {
      const parsed = new Date(endDate);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: true, reason: 'INVALID_END_DATE' });
      query.timestamp.$lte = parsed;
    }
  }
  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (Number.isNaN(parsedCursor.getTime())) return res.status(400).json({ error: true, reason: 'INVALID_CURSOR' });
    // Cursor on timestamp (not _id like members-list.js) — the primary sort
    // and the main filter dimension (startDate/endDate) are both timestamp,
    // so a single field serves both without a compound tie-break; a rare
    // exact-timestamp collision across two events costs at most one
    // duplicate/skip row at a page boundary, an acceptable trade for the
    // simpler cursor shape.
    query.timestamp = { ...query.timestamp, $lt: parsedCursor };
  }

  const events = await SecurityEvent.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('-metadata') // list view omits metadata (may be large/detailed) — see events-get.js for the single-event detail view
    .lean();

  const nextCursor = events.length === limit ? events[events.length - 1].timestamp.toISOString() : null;

  res.status(200).json({ events, cursor: nextCursor, limit });
};
