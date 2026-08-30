// Documented confidence/severity normalization (spec sections 21/23) — a
// provider's own scale is never trusted as-is; everything funnels through
// here so every provider (today: AbuseIPDB; future: any other) produces
// the same normalized 0-100 confidence and low/medium/high/critical
// severity vocabulary the rest of the app (ThreatIndicator.js, SecurityEvent
// enrichment, the risk engine) already speaks.

const CONFIDENCE_BANDS = Object.freeze([
  { max: 30, label: 'LOW' },
  { max: 60, label: 'MEDIUM' },
  { max: 80, label: 'HIGH' },
  { max: 100, label: 'VERY_HIGH' },
]);

const confidenceBandFor = (confidence) => (CONFIDENCE_BANDS.find((b) => confidence <= b.max) || CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1]).label;

// AbuseIPDB's `abuseConfidenceScore` is ALREADY a documented 0-100 integer
// (the percentage of reports the API judges credible) — this is the one
// provider field in this whole phase that needs no rescaling, only
// clamping against a malformed/out-of-range response. A future provider
// that reports on a different scale (e.g. VirusTotal's detection-engine
// ratio) would get its OWN mapping function here, never a fudge inside
// providers/abuseIpDb.js itself — this file is the single place "what does
// 'X% confident' even mean" is decided.
const normalizeAbuseIpDbConfidence = (abuseConfidenceScore) => {
  if (typeof abuseConfidenceScore !== 'number' || Number.isNaN(abuseConfidenceScore)) return 0;
  return Math.max(0, Math.min(100, Math.round(abuseConfidenceScore)));
};

// Severity is NOT confidence renamed (spec section 23: "do not directly
// equate malicious = critical"). Deliberately deterministic and
// documented: confidence alone drives the band, EXCEPT a status of CLEAN
// or UNKNOWN can never carry more than 'low' severity regardless of a
// stale/leftover confidence number — severity describes "how bad is this
// verdict," and a non-malicious verdict isn't bad at all.
const severityFor = (status, confidence) => {
  if (status !== 'MALICIOUS') return 'low';
  if (confidence >= 81) return 'critical';
  if (confidence >= 61) return 'high';
  if (confidence >= 31) return 'medium';
  return 'low';
};

module.exports = { confidenceBandFor, normalizeAbuseIpDbConfidence, severityFor };
