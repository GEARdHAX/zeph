const mongoose = require('mongoose');
const store = require('../store');

/**
 * GET /api/healthz
 *
 * Readiness probe used by Docker Compose healthchecks, load balancers,
 * and uptime monitors.
 *
 * Returns 200 { status: "ok" }         when a live DB ping succeeds.
 * Returns 503 { status: "degraded" }   when the DB is unreachable.
 *
 * Uses mongoose.connection.readyState + a live admin ping rather than a
 * store.connected flag that's only ever set true once at boot and never
 * reset on a later disconnect — that flag could report "ok" for hours
 * after Mongo actually dropped.
 *
 * This endpoint intentionally bypasses the "Database not available" middleware
 * in index.js so it can always respond (the middleware is app-level, this
 * route is registered on the API router which is mounted after that middleware —
 * see the note in backend/src/routes/index.js for ordering).
 */
module.exports = async (req, res) => {
  const base = {
    version: store.config?.appVersion || 'unknown',
    uptime: Math.floor(process.uptime()),
  };

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ ...base, status: 'degraded', db: 'disconnected' });
  }

  try {
    await mongoose.connection.db.admin().ping();
    return res.status(200).json({ ...base, status: 'ok', db: 'connected' });
  } catch (err) {
    return res.status(503).json({ ...base, status: 'degraded', db: 'unreachable' });
  }
};
