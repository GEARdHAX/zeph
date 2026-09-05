// Zeph AI — Request Deduplication and Distributed Locking (Phase 8).
// Prevents N simultaneous requests for the same expensive operation (e.g. a
// group summary) from triggering N provider calls: the first request wins
// the lock and does the work; concurrent requests reuse the same in-flight
// result once it lands (or get a "still generating" response, since these
// routes run synchronously — see routes/ai/summarize.js).
const logger = require('../logger');
const { getClient } = require('./redisClient');

const LOCK_PREFIX = 'ai:lock:';
const LOCK_TTL_MS = 30000; // provider timeout (config.aiProviderTimeoutMs, default 15s) plus margin — a crashed holder's lock self-expires, never stuck permanently (Phase 8 requirement)

// key example: ai:summary:{roomId}:{messageCountAtSummary} (conceptual key
// from the task spec) — callers build the semantic part, this just adds the
// prefix and does the SET NX PX dance.
const acquireLock = async (key) => {
  const redis = getClient();
  if (!redis) return { acquired: true, token: null }; // no Redis -> no coordination possible; caller proceeds uncoordinated (same "degrade, don't block" posture as every other Zeph AI Redis-optional path)
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    const result = await redis.set(`${LOCK_PREFIX}${key}`, token, 'PX', LOCK_TTL_MS, 'NX');
    return { acquired: result === 'OK', token };
  } catch (err) {
    logger.warn({ err, key }, 'ai_lock_acquire_failed_proceeding_uncoordinated');
    return { acquired: true, token: null };
  }
};

// Only releases if this caller's token still holds the lock (a plain DEL
// would let a slow caller delete a DIFFERENT, later holder's lock after its
// own TTL already expired and someone else acquired it).
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
const releaseLock = async (key, token) => {
  const redis = getClient();
  if (!redis || !token) return;
  try {
    await redis.eval(RELEASE_SCRIPT, 1, `${LOCK_PREFIX}${key}`, token);
  } catch (err) {
    logger.warn({ err, key }, 'ai_lock_release_failed'); // the TTL still bounds it — a failed release just means "waits out LOCK_TTL_MS" instead of "cleaned up immediately"
  }
};

module.exports = { acquireLock, releaseLock };
