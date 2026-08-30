// Pulls the source/request fields SecurityEventService.record() expects out
// of an Express req, consistently, so every call site doesn't reimplement
// "which IP field do I trust" itself. req.ip already reflects the resolved
// client IP correctly (see init.js's app.set('trust proxy', ...) — Express
// walks X-Forwarded-For itself once trust proxy is configured; this
// function does NOT read any X-Forwarded-For/CF-Connecting-IP header
// directly, on purpose, since a raw header read here would bypass that
// trust-proxy hop-count guard and reopen the IP-spoofing vector it exists
// to close).
const securityEventContext = (req) => ({
  ip: req.ip || null,
  userAgent: req.headers?.['user-agent'] || null,
  // init.js's passport JWT strategy now stashes the verified deviceId onto
  // req.user itself (not a schema field — never persisted on the User doc,
  // just carried through the request). A legacy pre-device-session token
  // (no deviceId in the payload) leaves this unset, same as before.
  deviceId: req.user?.deviceId || null,
  requestId: req.id || null,
});

module.exports = securityEventContext;
