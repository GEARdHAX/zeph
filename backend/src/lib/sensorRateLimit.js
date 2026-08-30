// ponytail: in-memory fixed-window counters, single-instance only — same
// shape/caveat as inviteRateLimit.js (Phase 2/3's own established pattern
// for a hand-rolled limiter; replace with Redis INCR+EXPIRE if this app
// ever runs multiple instances, same migration note every prior limiter
// in this codebase carries). Two independent buckets per spec section 31:
// PER-SENSOR (a single compromised/misbehaving sensor can't flood ZEPH)
// and GLOBAL (even many distinct sensors together are bounded, so 100
// legitimate sensors can't collectively overwhelm ingestion the way spec
// section 55's "1 sensor / 10 sensors / 100 sensors" load-test scenario
// implies is a real concern).
const perSensorBuckets = new Map();
let globalBucket = null;

const sweepIntervalMs = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of perSensorBuckets) {
    if (bucket.resetAt <= now) perSensorBuckets.delete(key);
  }
}, sweepIntervalMs).unref();

// perSensorMax/globalMax/windowMs configurable (spec section 35:
// ZEPH_EVENT_RATE_LIMIT) — see routes/index.js for the actual configured
// values. Runs AFTER sensorAuth (needs req.sensor.sensorId), same
// middleware-chain position convention every other limiter in this app
// already occupies (rate limiter, then auth, or vice versa depending on
// whether the limiter needs the authenticated identity to key on — this
// one does, so it comes second).
const sensorRateLimit = ({ perSensorMax, globalMax, windowMs }) => (req, res, next) => {
  const now = Date.now();

  if (!globalBucket || globalBucket.resetAt <= now) {
    globalBucket = { count: 0, resetAt: now + windowMs };
  }
  globalBucket.count += 1;
  if (globalBucket.count > globalMax) {
    return res.status(429).json({ error: true, reason: 'GLOBAL_RATE_LIMITED' });
  }

  const sensorId = req.sensor?.sensorId || 'unknown';
  let bucket = perSensorBuckets.get(sensorId);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    perSensorBuckets.set(sensorId, bucket);
  }
  bucket.count += 1;
  if (bucket.count > perSensorMax) {
    return res.status(429).json({ error: true, reason: 'SENSOR_RATE_LIMITED' });
  }

  return next();
};

module.exports = sensorRateLimit;
