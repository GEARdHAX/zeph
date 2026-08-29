// ponytail: in-memory fixed-window counter, single-instance only — same
// shape/caveat as inviteRateLimit.js (replace with Redis INCR+EXPIRE if the
// app ever runs multiple instances). A separate file rather than reusing
// inviteRateLimit.js because that one keys on req.user.id/req.ip; this route
// is unauthenticated and needs to key on the *target* email instead, so a
// per-IP-only limit can't stop one IP from hammering codes at many emails.
const buckets = new Map();

const sweepIntervalMs = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, sweepIntervalMs).unref();

// authCodeRateLimit({ max: 5, windowMs: 60 * 60 * 1000 })(email) -> boolean allowed
const authCodeRateLimit = ({ max, windowMs }) => (email) => {
  const key = email.toLowerCase();
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
};

module.exports = authCodeRateLimit;
