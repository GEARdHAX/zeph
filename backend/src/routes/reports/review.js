const Report = require('../../models/Report');
const { isPrivileged } = require('../../authorization/policy');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');
const logger = require('../../logger');

// POST /api/reports/:reportId/review — admin-only, moves a report out of
// OPEN into REVIEWED/ACTIONED/DISMISSED. Does not itself take any
// disciplinary action (no account suspension wired here) — actioning a
// report today just records the admin's decision; suspending/deactivating
// an account is a separate, already-existing admin capability this
// deliberately doesn't reach into, to keep report review and account
// moderation as independent concerns.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { reportId } = req.params;
  const { status } = req.fields;
  const RESOLVED_STATUSES = ['REVIEWED', 'ACTIONED', 'DISMISSED'];
  if (!RESOLVED_STATUSES.includes(status)) {
    return res.status(400).json({ error: true, reason: 'INVALID_STATUS' });
  }

  const report = await Report.findOneAndUpdate(
    { _id: reportId },
    { $set: { status, reviewedBy: req.user.id, reviewedAt: new Date() } },
    { new: true },
  ).catch(() => null);
  if (!report) return res.status(404).json({ error: true });

  logger.info({ reportId, adminId: req.user.id, status }, 'report_reviewed');
  SecurityEventService.record({
    type: 'ADMIN_ACTION',
    severity: 'low',
    actor: { userId: req.user.id },
    source: securityEventContext(req),
    target: { resource: 'report', resourceId: reportId, action: 'review' },
    result: 'success',
    metadata: { status },
  });

  res.status(200).json({ status: 'success', report: { _id: report._id, status: report.status } });
};
