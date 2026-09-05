// Zeph AI — Quota / Abuse Protection (Phase 5, hardened Phase 13). Layered
// Redis counters, same INCR+EXPIRE pattern as threatIntel/quota.js. Every
// layer fails OPEN on a Redis error (a quota-tracking failure must not
// itself take AI down — the provider call still has its own timeout) but
// fails CLOSED (blocks the request) when Redis is reachable and a real
// limit is hit.
//
// These are ZEPH's OWN self-imposed ceilings, deliberately stricter than
// Groq's actual free-tier limits — see docs/ZEPH-AI-ARCHITECTURE.md.
//
// Phase 13 hardening: checkQuota is now a READ-ONLY pre-flight check — it no
// longer increments the minute/day counters itself. Callers (ai/gateway.js)
// call recordUsage() ONLY after a provider call actually succeeds. This
// fixes a real bug: the original version incremented on every ATTEMPT, so a
// timed-out or 5xx'd Groq call still burned the user's daily quota — a
// user could be locked out for the day by nothing but provider flakiness,
// never having received a single successful AI result.
const logger = require('../logger');
const { getClient } = require('./redisClient');
const { REJECTION_REASONS } = require('./policy');

const PREFIX = 'ai:quota:';

const minuteBucketKey = (userId) => `${PREFIX}user:${userId}:min:${Math.floor(Date.now() / 60000)}`;
const dayBucketKey = (userId) => `${PREFIX}user:${userId}:day:${new Date().toISOString().slice(0, 10)}`;
const ipMinuteBucketKey = (ip) => `${PREFIX}ip:${ip}:min:${Math.floor(Date.now() / 60000)}`;

// Read-only — GET, never INCR. Concurrency counters are the exception:
// they must reflect "requests currently in flight," not "requests that
// succeeded," so acquireConcurrency/releaseConcurrency still bracket the
// ENTIRE attempt (including failures) — see ai/gateway.js.
const checkQuota = async ({ userId, ip, config }) => {
  const redis = getClient();
  if (!redis) return { allowed: true }; // no Redis configured -> no distributed quota possible; the express-rate-limit aiLimiter (init.js) remains the per-IP guard in that case

  const limits = {
    perUserPerMinute: config.aiLimitUserPerMinute ?? 5,
    perUserPerDay: config.aiLimitUserPerDay ?? 50,
    perUserConcurrent: config.aiLimitUserConcurrent ?? 2,
    perIpPerMinute: config.aiLimitIpPerMinute ?? 20,
    globalConcurrent: config.aiLimitGlobalConcurrent ?? 10,
  };

  try {
    const [userMinuteCount, userDayCount, ipMinuteCount, userConcurrent, globalConcurrent] = await Promise.all([
      redis.get(minuteBucketKey(userId)).then((v) => Number(v) || 0),
      redis.get(dayBucketKey(userId)).then((v) => Number(v) || 0),
      redis.get(ipMinuteBucketKey(ip)).then((v) => Number(v) || 0),
      redis.get(`${PREFIX}user:${userId}:concurrent`).then((v) => Number(v) || 0),
      redis.get(`${PREFIX}global:concurrent`).then((v) => Number(v) || 0),
    ]);

    if (userMinuteCount >= limits.perUserPerMinute) return { allowed: false, reason: REJECTION_REASONS.RATE_LIMITED, detail: 'user_per_minute' };
    if (userDayCount >= limits.perUserPerDay) return { allowed: false, reason: REJECTION_REASONS.QUOTA_EXCEEDED, detail: 'user_per_day' };
    if (ipMinuteCount >= limits.perIpPerMinute) return { allowed: false, reason: REJECTION_REASONS.RATE_LIMITED, detail: 'ip_per_minute' };
    if (userConcurrent >= limits.perUserConcurrent) return { allowed: false, reason: REJECTION_REASONS.RATE_LIMITED, detail: 'user_concurrent' };
    if (globalConcurrent >= limits.globalConcurrent) return { allowed: false, reason: REJECTION_REASONS.QUOTA_EXCEEDED, detail: 'global_concurrent' };

    return { allowed: true };
  } catch (err) {
    logger.warn({ err }, 'ai_quota_check_failed_failing_open');
    return { allowed: true };
  }
};

// Called ONLY after a provider call succeeds (ai/gateway.js) — this is what
// actually spends a unit of the user's/IP's minute+day budget. A failed
// attempt (timeout, 5xx, invalid output) never reaches this, so it never
// consumes quota (Phase 13: "Failed provider requests must not incorrectly
// consume user quota").
const recordUsage = async ({ userId, ip }) => {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.multi()
      .incr(minuteBucketKey(userId)).expire(minuteBucketKey(userId), 60)
      .incr(dayBucketKey(userId)).expire(dayBucketKey(userId), 26 * 60 * 60)
      .incr(ipMinuteBucketKey(ip)).expire(ipMinuteBucketKey(ip), 60)
      .exec();
  } catch (err) {
    logger.warn({ err }, 'ai_quota_record_usage_failed');
  }
};

// Concurrency slot bookkeeping — call acquire() after checkQuota() allows a
// request, and ALWAYS release() in a finally block, regardless of outcome
// (concurrency tracks "in flight," including failed attempts, so a slow
// timeout still counts against the user's concurrency limit while it's
// actually occupying one — this is intentionally NOT the same accounting as
// recordUsage's minute/day counters). TTL on the concurrency keys is a
// safety net against a crashed process leaking a slot forever.
const CONCURRENCY_TTL_SECONDS = 120; // generous vs. any single AI request's real duration; a stuck slot self-heals within 2 minutes even if release() is never reached
const acquireConcurrency = async (userId) => {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.multi()
      .incr(`${PREFIX}user:${userId}:concurrent`).expire(`${PREFIX}user:${userId}:concurrent`, CONCURRENCY_TTL_SECONDS)
      .incr(`${PREFIX}global:concurrent`).expire(`${PREFIX}global:concurrent`, CONCURRENCY_TTL_SECONDS)
      .exec();
  } catch (err) {
    logger.warn({ err }, 'ai_quota_acquire_failed');
  }
};

const releaseConcurrency = async (userId) => {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.multi()
      .decr(`${PREFIX}user:${userId}:concurrent`)
      .decr(`${PREFIX}global:concurrent`)
      .exec();
  } catch (err) {
    logger.warn({ err }, 'ai_quota_release_failed');
  }
};

module.exports = {
  checkQuota, recordUsage, acquireConcurrency, releaseConcurrency,
};
