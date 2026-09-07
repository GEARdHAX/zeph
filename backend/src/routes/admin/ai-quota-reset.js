const User = require('../../models/User');
const { isPrivileged } = require('../../authorization/policy');
const { resetUserQuota, getUserQuota, QUOTA_TYPES } = require('../../ai/quota');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');

// Zeph AI — admin: reset a user's AI quota.
// POST /api/admin/ai-quota/reset  { userId, types }
//   types: array subset of ['minute','day','concurrent'], or ['all'].
//
// Admin-only (404 for non-admins, same as the other admin surfaces). Every
// reset is recorded as an ADMIN_ACTION SecurityEvent — an admin lifting a
// user's rate limit is a privileged action worth an audit trail.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { userId } = req.fields || {};
  let { types } = req.fields || {};
  // express-formidable serializes an array field oddly depending on how the
  // client sends it — normalize to a string array.
  if (typeof types === 'string') types = types.split(',').map((t) => t.trim());
  if (!Array.isArray(types)) types = [];

  if (!userId) return res.status(400).json({ error: true, message: 'userId is required.' });

  const requested = types.includes('all') ? ['all'] : types.filter((t) => QUOTA_TYPES.includes(t));
  if (requested.length === 0) {
    return res.status(400).json({ error: true, message: `types must be one or more of ${QUOTA_TYPES.join(', ')} or "all".` });
  }

  const target = await User.findById(userId).select('_id username level').catch(() => null);
  if (!target) return res.status(404).json({ error: true });

  const result = await resetUserQuota(userId, requested);
  if (!result.ok) {
    const message = result.reason === 'REDIS_UNAVAILABLE'
      ? 'Quota tracking is not active on this server (no Redis configured).'
      : 'Could not reset the quota. Please try again.';
    return res.status(result.reason === 'REDIS_UNAVAILABLE' ? 409 : 500).json({ error: true, reason: result.reason, message });
  }

  SecurityEventService.record({
    type: 'ADMIN_ACTION',
    severity: 'low',
    actor: { userId: req.user.id },
    source: securityEventContext(req),
    target: { resource: 'ai_quota', resourceId: userId, action: 'reset' },
    result: 'success',
    metadata: { targetUsername: target.username, cleared: result.cleared, keysDeleted: result.deleted },
  });

  // Return the post-reset usage so the UI can refresh in place.
  const usage = await getUserQuota(userId);
  res.status(200).json({ ok: true, cleared: result.cleared, usage });
};
