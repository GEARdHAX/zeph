// Call Timeline / Call History — ephemeral heartbeat state (spec §14).
// NOT the source of truth for call history (Mongo's CallSession/
// CallTimelineEvent are — see callHistoryService.js); this is purely a
// stale-session detector for the one failure mode the ordinary socket
// 'disconnect' event does NOT cover: the whole Node process dying (crash,
// OOM kill, deploy restart) without ever running its disconnect handlers at
// all, leaving a CallSession stuck ACTIVE forever with no real socket
// behind it.
//
// Own ioredis client, same one-client-per-concern convention as
// ai/redisClient.js/userProfileCache.js/etc. (this codebase deliberately
// does not share one Redis connection across unrelated subsystems — see
// ai/redisClient.js's own comment). Uses that same FIXED reconnect pattern
// (bounded backoff + explicit connect at creation), not the older
// retryStrategy:()=>null pattern still present in a couple of this
// codebase's other modules, which was found earlier this project to
// permanently kill itself on the first Redis blip.
const IORedis = require('ioredis');
const store = require('../store');
const logger = require('../logger');

const KEY_PREFIX = 'active_call:';
// Comfortably longer than any realistic gap between heartbeats — a
// heartbeat is refreshed on every recordConnected/recordDisconnected call
// today (join/leave are the only lifecycle ticks that exist), so this TTL
// is really "how long a crashed process's orphaned key survives before a
// future reconciliation sweep could safely treat it as stale," not a tight
// liveness SLA.
const TTL_SECONDS = 5 * 60;

let client = null;
const getClient = () => {
  if (!store.config?.redisUrl) return null;
  if (!client) {
    client = new IORedis(store.config.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      retryStrategy: (times) => Math.min(times * 200, 5000),
      reconnectOnError: () => true,
      lazyConnect: true,
    });
    client.on('error', (err) => logger.warn({ err }, 'Call history Redis client error'));
    client.connect().catch((err) => logger.warn({ err }, 'Call history Redis initial connect failed — will retry'));
  }
  return client;
};

const key = (meetingId, userId) => `${KEY_PREFIX}${meetingId}:${userId}`;

// Best-effort throughout — a Redis outage must never block or fail an
// actual call connect/disconnect (Mongo remains authoritative regardless;
// see callHistoryService.js). Every function here swallows its own errors.
const setActiveCall = async (meetingId, userId, sessionId) => {
  const redis = getClient();
  if (!redis) return;
  const payload = JSON.stringify({ sessionId: sessionId.toString(), connectedAt: new Date().toISOString() });
  await redis.set(key(meetingId, userId), payload, 'EX', TTL_SECONDS).catch((err) => {
    logger.warn({ err, meetingId: meetingId.toString(), userId: userId.toString() }, 'Failed to set active-call heartbeat');
  });
};

const clearActiveCall = async (meetingId, userId) => {
  const redis = getClient();
  if (!redis) return;
  await redis.del(key(meetingId, userId)).catch((err) => {
    logger.warn({ err, meetingId: meetingId.toString(), userId: userId.toString() }, 'Failed to clear active-call heartbeat');
  });
};

const closeCallHistoryRedisConnection = async () => {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = null;
  }
};

module.exports = { setActiveCall, clearActiveCall, closeCallHistoryRedisConnection };
