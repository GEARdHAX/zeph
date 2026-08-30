const { getClient } = require('./cache');
const logger = require('../../logger');

// Known-service baseline (spec section 22-23) — configurable, explainable,
// bounded, poisoning-resistant. TWO separate sets, never merged
// automatically:
//
//   TRUSTED   — operator-configured only (NETWORK_BASELINE_TRUSTED env var,
//               a comma-separated destinationIp or destinationIp:port list —
//               "MongoDB/Redis/Cloudflare/Brevo/R2/known application
//               services", spec section 41). Never written to at runtime.
//   CANDIDATE — destinations OBSERVED for the first time get added here
//               (Redis, with a TTL — a candidate that's never promoted just
//               ages out, it doesn't silently become permanent). An admin
//               promotes a candidate to TRUSTED out-of-band (config change +
//               redeploy, matching how every other ZEPH config value works —
//               no promotion API in this pass; see the final report's
//               deferred-work note). This is the safe mechanism spec section
//               23 asks for: "observed -> candidate -> review/validation ->
//               trusted," NOT "new destination -> automatically trusted."
//
// A destination that is NEITHER trusted NOR even a prior candidate is what
// networkRules.js treats as UNUSUAL_DESTINATION-eligible — the first time
// it's ever unusual, it also gets recorded as a candidate so a SECOND
// connection to the same place within the candidate TTL is no longer
// "brand new," without ever being silently trusted.
const CANDIDATE_PREFIX = 'netintel:baseline:candidate:';
const CANDIDATE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — long enough that a legitimate recurring destination naturally stops looking "new" well before the window lapses, short enough that a genuinely one-off destination doesn't linger forever

// Cloudflare awareness (spec section 39): ZEPH sits behind Cloudflare, so a
// network sensor observing the app host's own connections will legitimately
// see Cloudflare edge IPs constantly (inbound from Cloudflare to the app,
// and any outbound calls ZEPH itself makes through it). Rather than hard-
// coding Cloudflare's published IP ranges here (they rotate; maintaining a
// duplicate copy of Cloudflare's own list is exactly the unjustified
// scope this codebase's ponytail convention avoids), Cloudflare is treated
// as just another entry an operator adds to NETWORK_BASELINE_TRUSTED (spec
// section 41 groups it there explicitly, alongside MongoDB/Redis/Brevo/R2).
// This keeps the mechanism uniform (one trusted-destination list, not a
// special-cased Cloudflare path) and correct-by-construction: a deployment
// that hasn't configured it simply won't get false THREAT_INTEL_NETWORK_
// MATCH/UNUSUAL_DESTINATION noise suppressed for Cloudflare specifically —
// see ebpf-sensor/README.md's deployment section for the recommended
// values to add.
const parseTrustedList = (raw) => new Set(
  (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

// destinationKey lets the trusted list express either a bare IP (any port)
// or ip:port (exact) — checked in that order, most-specific first.
const isTrustedDestination = (trustedSet, destinationIp, destinationPort) => {
  if (!destinationIp) return false;
  const ip = destinationIp.toLowerCase();
  if (Number.isInteger(destinationPort) && trustedSet.has(`${ip}:${destinationPort}`)) return true;
  return trustedSet.has(ip);
};

const candidateKey = (destinationIp) => `${CANDIDATE_PREFIX}${destinationIp}`;

// Returns true if this destination was ALREADY a known candidate (seen
// before); records it as a candidate either way. Redis unavailable -> every
// destination looks "new" every time (fail toward more scrutiny, not less —
// same direction riskEngine.js's own UNKNOWN_DEVICE fallback takes).
const isKnownCandidate = async (destinationIp) => {
  const redis = getClient();
  if (!redis || !destinationIp) return false;
  try {
    const key = candidateKey(destinationIp);
    const existed = await redis.exists(key);
    await redis.expire(key, CANDIDATE_TTL_SECONDS); // refresh TTL on every sighting, whether new or repeat
    if (!existed) await redis.set(key, '1', 'EX', CANDIDATE_TTL_SECONDS);
    return existed === 1;
  } catch (err) {
    logger.warn({ err, destinationIp }, 'network_intel_baseline_candidate_check_failed');
    return false;
  }
};

module.exports = { parseTrustedList, isTrustedDestination, isKnownCandidate };
