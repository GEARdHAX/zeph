const Room = require('../../models/Room');
const Report = require('../../models/Report');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');
const logger = require('../../logger');

const MAX_DETAILS_LENGTH = 1000;

// POST /api/reports — file a report against another user, from inside a
// conversation (TopBar.jsx's "Report" action). Deliberately does NOT route
// through authorization/policy.js's authorizeAction()/isBlocked() — that
// helper denies action when the two users have blocked each other, which
// is exactly backwards for reporting: blocking someone is often the reason
// you want to report them too, so a report must stay possible regardless
// of block state. The only real gate here is "you actually share this
// room" — the same membership check every other room-scoped route uses.
module.exports = async (req, res) => {
  const { roomID, reportedUserId, reason, details } = req.fields;
  const reporterId = req.user.id;

  if (!roomID || !reportedUserId || !reason) {
    return res.status(400).json({ error: true, reason: 'MISSING_FIELDS' });
  }
  if (!Report.REASONS.includes(reason)) {
    return res.status(400).json({ error: true, reason: 'INVALID_REASON' });
  }
  if (reportedUserId.toString() === reporterId.toString()) {
    return res.status(400).json({ error: true, reason: 'SELF_REPORT' });
  }

  const room = await Room.findOne({ _id: roomID }).select('people').catch(() => null);
  if (!room) return res.status(404).json({ error: true });

  const memberIds = room.people.map((id) => id.toString());
  if (!memberIds.includes(reporterId.toString()) || !memberIds.includes(reportedUserId.toString())) {
    return res.status(403).json({ error: true });
  }

  const safeDetails = typeof details === 'string' ? details.slice(0, MAX_DETAILS_LENGTH) : '';

  // A repeat report on the same person, in the same room, while an earlier
  // one is still OPEN is a duplicate submission, not a new incident —
  // upsert into the existing open row instead of piling up near-identical
  // OPEN reports every time someone re-clicks Report.
  let report;
  try {
    report = await Report.findOneAndUpdate(
      { reporter: reporterId, reportedUser: reportedUserId, room: roomID, status: 'OPEN' },
      { $set: { reason, details: safeDetails, createdAt: new Date() } },
      { upsert: true, new: true },
    );
  } catch (err) {
    logger.error({ err, reporterId, reportedUserId, roomID }, 'Failed to file report');
    return res.status(500).json({ error: true });
  }

  logger.info({ reportId: report._id, reporterId, reportedUserId, roomID, reason }, 'user_reported');
  // A user-filed report isn't itself an ADMIN_ACTION (no admin acted yet) —
  // recorded under its own type so it surfaces in security telemetry without
  // being misfiled as something an admin did.
  SecurityEventService.record({
    type: 'USER_REPORTED',
    severity: 'medium',
    actor: { userId: reporterId },
    source: securityEventContext(req),
    target: { resource: 'user', resourceId: reportedUserId, action: 'report' },
    result: 'success',
    metadata: { reportId: report._id.toString(), roomID, reason },
  });

  res.status(200).json({ status: 'success', reportId: report._id });
};
