const User = require('../../models/User');
const { isPrivileged } = require('../../authorization/policy');
const { getUserQuota } = require('../../ai/quota');
const store = require('../../store');

// Zeph AI — admin: inspect a user's current AI quota usage.
// GET /api/admin/ai-quota/:userId
//
// Admin-only. Follows the same "404, don't leak that the route exists"
// posture as the other admin surfaces (routes/index.js's comment on
// isPrivileged 404s) — a non-admin gets 404, not 403.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const { userId } = req.params;
  const target = await User.findById(userId)
    .select('_id username firstName lastName')
    .catch(() => null);
  if (!target) return res.status(404).json({ error: true });

  const config = store.config || {};
  const usage = await getUserQuota(userId);

  res.status(200).json({
    user: {
      _id: target._id,
      username: target.username,
      firstName: target.firstName,
      lastName: target.lastName,
    },
    // null when Redis isn't configured — the frontend shows "quota tracking
    // is not active on this server" rather than fake zeros.
    usage,
    limits: {
      perMinute: config.aiLimitUserPerMinute ?? 5,
      perDay: config.aiLimitUserPerDay ?? 50,
      concurrent: config.aiLimitUserConcurrent ?? 2,
    },
  });
};
