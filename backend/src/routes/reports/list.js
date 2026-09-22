const Report = require('../../models/Report');
const { isPrivileged } = require('../../authorization/policy');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

// GET /api/reports — admin-only queue of filed reports. Same 404-for-non-
// admin convention as every other admin surface (never a distinguishable
// 403, see DECISIONS.md's anti-enumeration note).
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  let { status, limit } = req.query;
  limit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter = {};
  if (status && Report.STATUSES.includes(status)) filter.status = status;

  const reports = await Report.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('reporter', 'firstName lastName username')
    .populate('reportedUser', 'firstName lastName username accountStatus')
    .lean();

  res.status(200).json({ reports });
};
