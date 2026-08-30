const SecurityEventService = require('../services/securityEventService');
const securityEventContext = require('../utils/securityEventContext');

// ponytail: in-memory fixed-window counter, single-instance only — fine for
// zeph's current single-process deployment. If the app ever runs multiple
// instances, replace the Map with Redis INCR+EXPIRE (same key shape) since
// this state won't be shared across processes.
const buckets = new Map();

const sweepIntervalMs = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, sweepIntervalMs).unref();

// windowMs/max scoped per route via closure — e.g. inviteRateLimit({ max: 10, windowMs: 60_000 }).
// Keyed on req.user.id when authenticated (create/accept/join routes), else
// falls back to IP (preview routes, which are intentionally unauthenticated).
const inviteRateLimit = ({ max, windowMs, keyPrefix }) => (req, res, next) => {
  const key = `${keyPrefix}:${req.user ? req.user.id : req.ip}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    SecurityEventService.record({
      type: 'RATE_LIMIT_TRIGGERED',
      severity: 'medium',
      actor: req.user ? { userId: req.user.id } : {},
      source: securityEventContext(req),
      target: { resource: req.originalUrl, action: keyPrefix },
      result: 'blocked',
      metadata: { limiter: keyPrefix },
    });
    return res.status(429).json({ error: true, reason: 'RATE_LIMITED' });
  }
  return next();
};

module.exports = inviteRateLimit;
