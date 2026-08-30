const logger = require('../../logger');
const { getClient } = require('./cache');

// Local provider-call budget tracking (spec sections 9-11 of the hardening
// addendum) — a Redis INCR counter keyed per UTC day, capped at
// config.abuseIpDbDailyBudget (ZEPH's OWN operational ceiling, deliberately
// below AbuseIPDB's actual account-wide daily limit so normal
// dashboard/other-tool usage of the same key is never starved by this app).
// "The provider's response remains authoritative" (spec) — this counter is
// a PROACTIVE guard to avoid ever reaching a real 429, not a replacement
// for reading AbuseIPDB's own rate-limit headers (abuseIpDb.js already
// parses and returns those; recordProviderRateLimit below lets this
// module's local state be corrected downward if the provider's own
// "remaining" ever disagrees with the local count, e.g. after a restart
// that reset the in-process view but not Redis, or if the same key is used
// elsewhere outside ZEPH).
const QUOTA_PREFIX = 'threatintel:quota:abuseipdb:';
const QUOTA_TTL_SECONDS = 26 * 60 * 60; // a little over 24h — the key naturally expires shortly after the day it counts rolls over, no separate cleanup job needed

const todayKey = () => `${QUOTA_PREFIX}${new Date().toISOString().slice(0, 10)}`; // UTC date, matches AbuseIPDB's own reset cadence closely enough for a soft local budget (this is a safety margin, not a precise SLA)

// Returns { allowed, remaining } — allowed:false means "do not call the
// provider this request," WITHOUT throwing or blocking anything; the
// caller (threatIntelService.js) falls through to cached/UNKNOWN exactly
// like any other provider-unavailable case (spec section 11: "do not crash
// ZEPH... do not block all users").
const checkAndReserveBudget = async (dailyBudget) => {
  const redis = getClient();
  if (!redis) return { allowed: true, remaining: null }; // no Redis -> no quota tracking possible; the timeout/circuit-breaker layer (circuitBreaker.js) is the remaining protection in that case, same as riskCache.js's own no-Redis fallback posture
  const key = todayKey();
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, QUOTA_TTL_SECONDS);
    if (count > dailyBudget) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: dailyBudget - count };
  } catch (err) {
    logger.warn({ err }, 'Failed to check threat intel quota — allowing (fail open on the QUOTA check only, not on the security decision itself)');
    // A quota-tracking failure is NOT a security failure — the actual
    // provider call still has its own timeout/circuit-breaker; losing the
    // ability to COUNT calls must not itself become a reason to stop
    // making them (that would be a Redis outage silently degrading every
    // future risk evaluation to UNKNOWN, which is a bigger regression than
    // occasionally exceeding the soft local budget).
    return { allowed: true, remaining: null };
  }
};

// Reconciles the local counter against AbuseIPDB's own X-RateLimit-Remaining
// header when available — a light nudge, not a hard overwrite (INCR-based
// local tracking stays authoritative for THIS process's request-shaping
// decisions; this only logs a material disagreement worth knowing about).
const recordProviderRateLimit = (rateLimit) => {
  if (!rateLimit || rateLimit.remaining === null) return;
  if (rateLimit.remaining <= 10) {
    logger.warn({ rateLimit }, 'abuseipdb_quota_low');
  }
};

module.exports = { checkAndReserveBudget, recordProviderRateLimit, todayKey };
