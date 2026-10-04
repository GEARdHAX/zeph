// Lightweight safety net for Cloudflare Realtime's free allowance (1,000 GB of
// egress a month). It counts participant-minutes per calendar month and only
// refuses NEW joins once a generous ceiling is passed — normal use never gets
// near it, and it fails open: any Redis problem allows the call.
//
// ponytail: participant-minutes are a proxy, not measured egress. At the default 720p / 1.5 Mbps
// cap a received stream is ~0.7 GB/hour and, with the 4-person cap, each participant receives ~3
// streams (~2 GB/hour), so the 25,000-minute default (~417 participant-hours, ~830 GB) stays inside
// the free allowance. Lower CALL_MAX_VIDEO_KBPS to stretch it. If real numbers ever matter, read
// Cloudflare's usage API instead.
const store = require('../../store');
const logger = require('../../logger');
const { getClient } = require('../../ai/redisClient');

const monthKey = () => `calls:cf:participant-minutes:${new Date().toISOString().slice(0, 7)}`;
const REDIS_TIMEOUT_MS = 500;

const withTimeout = (promise) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('usage_guard_timeout')), REDIS_TIMEOUT_MS))]);

const limit = () => store.config?.callMonthlyParticipantMinutes || 50000;

const isAllowed = async () => {
  try {
    const redis = getClient();
    if (!redis) return true;
    const used = Number(await withTimeout(redis.get(monthKey()))) || 0;
    return used < limit();
  } catch (err) {
    logger.debug({ err }, 'call usage guard unavailable, allowing');
    return true;
  }
};

const recordMinutes = async (minutes) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  try {
    const redis = getClient();
    if (!redis) return;
    const key = monthKey();
    await withTimeout(redis.incrbyfloat(key, minutes));
    await withTimeout(redis.expire(key, 40 * 24 * 60 * 60));
  } catch (err) {
    logger.debug({ err }, 'call usage guard could not record minutes');
  }
};

module.exports = { isAllowed, recordMinutes };
