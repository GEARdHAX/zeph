const crypto = require('crypto');
const logger = require('../../logger');
const { getClient } = require('./cache');

// Cache-stampede / single-flight protection (spec sections 7-8 of the
// hardening addendum): when 1,000 requests for the same indicator arrive
// after its cache entry expires, exactly ONE of them should reach the
// provider — the other 999 either wait briefly and reuse that one result,
// or (if the wait times out) fall through to a safe non-provider answer
// rather than each independently calling AbuseIPDB.
//
// Lock primitive: Redis SET key value NX PX ttl — the standard atomic
// acquire-with-expiry pattern (single command, no separate EXPIRE call that
// could race/leak a lock past a crash between the two). Self-expiring by
// design, so a process that dies mid-lookup can never leave the lock held
// forever (spec's own requirement: "have an expiration... avoid deadlocks
// ... not block requests indefinitely").
const LOCK_PREFIX = 'threatintel:lock:';
const LOCK_TTL_MS = 8000; // comfortably longer than abuseIpDb.js's own request timeout (default 5000ms) plus normalize/persist overhead, so the lock can never expire out from under a lookup that's still legitimately in flight
const WAIT_POLL_INTERVAL_MS = 150;
const WAIT_TIMEOUT_MS = 4000; // a waiting caller gives up and proceeds WITHOUT the lock well before LOCK_TTL_MS — never blocks a real user-facing request for the full lock lifetime

const lockKey = (indicatorKey) => `${LOCK_PREFIX}${indicatorKey}`;

// Returns a real token string on success; null if Redis IS available but
// the lock is genuinely contended (caller should wait briefly — see
// waitForResult below); undefined if coordination isn't possible AT ALL
// (no Redis configured) — a distinct falsy value on purpose, so
// threatIntelService.js can tell "someone else is looking this up right
// now, worth a short wait" apart from "there is no 'someone else' to wait
// for, coordination simply doesn't exist here" and skip the wait entirely
// in the latter case rather than always paying WAIT_TIMEOUT_MS.
const tryAcquireLock = async (indicatorKey) => {
  const redis = getClient();
  if (!redis) return undefined;
  const token = crypto.randomUUID();
  const acquired = await redis.set(lockKey(indicatorKey), token, 'PX', LOCK_TTL_MS, 'NX').catch((err) => {
    logger.warn({ err, indicatorKey }, 'Failed to acquire threat intel single-flight lock');
    return null;
  });
  return acquired === 'OK' ? token : null;
};

// Only releases the lock if it still holds OUR token — a Lua script (single
// atomic GET+DEL) rather than a separate GET-then-DEL, which would have a
// race where this process's slow release could delete a DIFFERENT holder's
// lock acquired after this one's TTL already expired naturally.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const releaseLock = async (indicatorKey, token) => {
  const redis = getClient();
  if (!redis || !token) return;
  await redis.eval(RELEASE_SCRIPT, 1, lockKey(indicatorKey), token).catch((err) => {
    logger.warn({ err, indicatorKey }, 'Failed to release threat intel single-flight lock');
  });
};

// Waits briefly for an in-flight lookup (held by another process/request)
// to finish and populate the cache, polling the ACTUAL cache (not the lock)
// so it returns the moment real data lands rather than waiting the full
// timeout. Returns null on timeout — caller (threatIntelService.js) treats
// that as "proceed without the lock, but respect quota" rather than
// stalling the request indefinitely.
const waitForResult = async (indicatorKey, readCacheFn) => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const result = await readCacheFn(indicatorKey);
    if (result) return result;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, WAIT_POLL_INTERVAL_MS); });
  }
  return null;
};

module.exports = {
  tryAcquireLock, releaseLock, waitForResult, LOCK_TTL_MS, WAIT_TIMEOUT_MS,
};
