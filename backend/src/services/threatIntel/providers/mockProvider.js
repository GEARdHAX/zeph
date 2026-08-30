// Deterministic mock provider (spec section 32) — used ONLY by tests
// (threatIntelService tests pass this in directly rather than going through
// provider.js's config-driven selection, so a real AbuseIPDB call is never
// possible in CI regardless of what THREAT_INTEL/ABUSEIPDB env vars a test
// runner happens to have set). Fixed, documented indicator->result mapping,
// no network, no timing variance — makes cache-hit/miss and single-flight
// tests reliably assertable.
const MOCK_MALICIOUS_IP = '198.51.100.66'; // TEST-NET-2, RFC5737 — never a real routable address
const MOCK_CLEAN_IP = '8.8.8.8';

const buildMockProvider = ({
  malicious = [MOCK_MALICIOUS_IP], failOn = [], failReason = 'server_error', latencyMs = 0,
} = {}) => {
  let callCount = 0;
  return {
    enabled: true,
    name: 'mock',
    callCount: () => callCount,
    async lookupIndicator(indicator) {
      callCount += 1;
      if (latencyMs) await new Promise((resolve) => { setTimeout(resolve, latencyMs); });

      if (failOn.includes(indicator)) {
        // failReason defaults to 'server_error' — one of
        // circuitBreaker.js's real TRIPPING_REASONS, so a test using the
        // default actually exercises the breaker; pass a non-tripping
        // reason (e.g. 'rejected') explicitly to test the "this kind of
        // failure does NOT trip the breaker" path instead.
        return {
          ok: false, reason: failReason, status: 500, rateLimit: null,
        };
      }

      if (malicious.includes(indicator)) {
        return {
          ok: true,
          found: true,
          malicious: true,
          confidence: 94,
          severity: 'critical',
          categories: ['ABUSE'],
          source: 'mock',
          sourceId: null,
          rateLimit: { limit: 1000, remaining: 999, retryAfterSeconds: null },
          metadata: { mock: true },
        };
      }

      // Everything else, including MOCK_CLEAN_IP, is an explicit CLEAN
      // verdict (found:true, malicious:false) — distinct from a provider
      // failure (ok:false) or a genuinely-never-checked UNKNOWN.
      return {
        ok: true,
        found: true,
        malicious: false,
        confidence: 0,
        severity: 'low',
        categories: [],
        source: 'mock',
        sourceId: null,
        rateLimit: { limit: 1000, remaining: 999, retryAfterSeconds: null },
        metadata: { mock: true },
      };
    },
  };
};

module.exports = { buildMockProvider, MOCK_MALICIOUS_IP, MOCK_CLEAN_IP };
