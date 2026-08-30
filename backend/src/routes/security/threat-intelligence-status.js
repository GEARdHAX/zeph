const store = require('../../store');
const { isPrivileged } = require('../../authorization/policy');
const threatIntelService = require('../../services/threatIntel/threatIntelService');
const { getClient } = require('../../services/threatIntel/cache');
const { todayKey } = require('../../services/threatIntel/quota');

// Admin provider-health view (spec section 36) — deliberately minimal
// (spec: "the exact dashboard can remain minimal until Phase 8"). Never
// returns the API key or any other credential — only operational status
// derived from in-process state (the circuit breaker) and Redis (today's
// quota counter), neither of which can leak a secret by construction.
module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const config = store.config || {};
  const redis = getClient();

  let usedToday = 0;
  if (redis) {
    const raw = await redis.get(todayKey()).catch(() => null);
    usedToday = raw ? Number(raw) : 0;
  }

  res.status(200).json({
    provider: config.abuseIpDbEnabled && config.abuseIpDbApiKey ? 'abuseipdb' : 'disabled',
    enabled: !!(config.abuseIpDbEnabled && config.abuseIpDbApiKey),
    circuitState: threatIntelService.breaker.getState(),
    dailyBudget: config.abuseIpDbDailyBudget || 0,
    usedToday,
    remainingToday: Math.max(0, (config.abuseIpDbDailyBudget || 0) - usedToday),
    cacheTtlSeconds: config.threatIntelCacheTtlSeconds || 0,
    redisConfigured: !!redis,
  });
};
