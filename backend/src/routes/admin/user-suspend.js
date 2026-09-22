const User = require('../../models/User');
const store = require('../../store');
const { isPrivileged } = require('../../authorization/policy');
const SecurityEventService = require('../../services/securityEventService');
const securityEventContext = require('../../utils/securityEventContext');
const logger = require('../../logger');

// POST /api/admin/user/suspend { userId, suspended: true|false } — sets
// User.accountStatus to DEACTIVATED/ACTIVE. Reversible, unlike the existing
// root-only hard-delete (user-delete.js) — any admin/privileged user can
// suspend or reactivate. DEACTIVATED was reserved schema-only until now
// (see User.js's model comment); this is the first route that actually
// writes it. Enforcement is immediate: the JWT passport strategy
// (backend/src/init.js) checks accountStatus on every authenticated
// request, so an already-issued session is cut off right away, and
// login.js refuses a fresh login for a suspended account.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { userId } = req.fields;
  const suspended = req.fields.suspended === true || req.fields.suspended === 'true';

  if (!userId) return res.status(400).json({ error: true });
  if (userId.toString() === req.user.id.toString()) {
    return res.status(400).json({ error: true, reason: 'CANNOT_SUSPEND_SELF' });
  }

  const target = await User.findById(userId).select('_id username level accountStatus').catch(() => null);
  if (!target) return res.status(404).json({ error: true });

  // An admin can't be suspended by a peer admin through this lighter-weight
  // flow — matches the admin-privacy-boundary reasoning used elsewhere
  // (roomHasBoundaryViolation.js): a standard-level report reviewer must
  // never be able to touch a privileged account's status here.
  if (isPrivileged(target) && !target._id.equals(req.user.id)) {
    return res.status(403).json({ error: true, reason: 'CANNOT_SUSPEND_PRIVILEGED' });
  }

  target.accountStatus = suspended ? 'DEACTIVATED' : 'ACTIVE';
  await target.save();

  logger.info(
    { targetUserId: target._id, adminId: req.user.id, suspended },
    suspended ? 'user_suspended' : 'user_reactivated',
  );
  SecurityEventService.record({
    type: 'ADMIN_ACTION',
    severity: suspended ? 'high' : 'medium',
    actor: { userId: req.user.id },
    source: securityEventContext(req),
    target: { resource: 'user', resourceId: target._id.toString(), action: suspended ? 'suspend' : 'reactivate' },
    result: 'success',
    metadata: { targetUsername: target.username },
  });

  // Force the suspended user's live session(s) to actually disconnect, not
  // just get rejected on their NEXT request — mirrors user-delete.js's own
  // 'user-deleted' emit to the same personal room.
  if (suspended) {
    store.io.to(target._id.toString()).emit('account-suspended');
  }

  res.status(200).json({ status: 'success', accountStatus: target.accountStatus });
};
