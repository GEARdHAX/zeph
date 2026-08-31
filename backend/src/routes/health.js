const mongoose = require('mongoose');
const store = require('../store');
const { getQueueConnection } = require('../queues/connection');

/**
 * GET /api/health/live
 *
 * Liveness probe — "is the process alive at all," nothing more. Never
 * touches Mongo/Redis/any dependency — a slow/degraded dependency must
 * never make an orchestrator think the PROCESS itself needs restarting
 * (that's what /health/ready is for). Always 200 as long as the Node
 * event loop is responsive enough to answer an HTTP request at all.
 */
const live = (req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
};

// Bounded — a health check that can itself hang defeats the point of a
// timely readiness signal. 2s is generous for a PING to an already-
// established connection (this reuses BullMQ's own long-lived client,
// never opens a new one just to check).
const REDIS_PING_TIMEOUT_MS = 2000;

const pingRedis = async () => {
  const redis = getQueueConnection();
  if (!redis) return 'not_configured'; // no REDIS_URL set — a valid, non-degraded state for this app (see DECISIONS.md D-035), not a failure
  try {
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('redis_ping_timeout')), REDIS_PING_TIMEOUT_MS); }),
    ]);
    return 'connected';
  } catch (err) {
    return 'unreachable';
  }
};

/**
 * GET /api/health/ready
 *
 * Readiness probe — required dependencies must actually be reachable
 * before this process should receive traffic. Docker Compose healthchecks,
 * load balancers, and uptime monitors all point here (see docker-compose.yml/
 * docker-compose.prod.yml).
 *
 * Returns 200 { status: "ok" }         when Mongo is reachable (and Redis,
 *                                        if configured, responds to PING).
 * Returns 503 { status: "degraded" }   when Mongo is unreachable, or Redis
 *                                        is configured but not responding.
 *
 * Mongo uses mongoose.connection.readyState + a live admin ping rather
 * than a store.connected flag that's only ever set true once at boot and
 * never reset on a later disconnect — that flag could report "ok" for
 * hours after Mongo actually dropped.
 *
 * This endpoint intentionally bypasses the "Database not available"
 * middleware in index.js so it can always respond (the middleware is
 * app-level, this route is registered on the API router which is mounted
 * after that middleware — see the note in backend/src/routes/index.js for
 * ordering).
 */
const ready = async (req, res) => {
  const base = {
    version: store.config?.appVersion || 'unknown',
    uptime: Math.floor(process.uptime()),
  };

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ ...base, status: 'degraded', db: 'disconnected' });
  }

  let db;
  try {
    await mongoose.connection.db.admin().ping();
    db = 'connected';
  } catch (err) {
    return res.status(503).json({ ...base, status: 'degraded', db: 'unreachable' });
  }

  const redis = await pingRedis();
  // Redis being unreachable when it IS configured is degraded (Socket.IO
  // cross-instance delivery, presence, rate limiting, caching, and BullMQ
  // all silently fall back to single-process/no-cache behavior per this
  // codebase's own established convention — never a hard outage, but
  // genuinely degraded capacity worth surfacing to an orchestrator/
  // monitor). Redis simply not being configured at all is NOT degraded —
  // that's this app's supported single-instance mode.
  if (redis === 'unreachable') {
    return res.status(503).json({
      ...base, status: 'degraded', db, redis,
    });
  }

  return res.status(200).json({
    ...base, status: 'ok', db, redis,
  });
};

module.exports = ready;
module.exports.live = live;
module.exports.ready = ready;
