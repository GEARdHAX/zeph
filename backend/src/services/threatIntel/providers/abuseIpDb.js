const logger = require('../../../logger');
const { normalizeAbuseIpDbConfidence, severityFor } = require('../confidence');

// AbuseIPDB /check endpoint — https://docs.abuseipdb.com/. IP reputation
// only (the endpoint this phase actually calls); AbuseIPDB has no domain/
// URL/hash reputation product, so ThreatIntelService.js's lookup() for
// those types simply gets `found:false` from this provider today — a
// future provider (e.g. one with domain/hash coverage) plugs into the same
// interface without this file changing.
//
// maxAgeInDays:90 matches AbuseIPDB's own default lookback for the
// abuseConfidenceScore calculation — not configurable here since changing
// it would change what the returned confidence NUMBER even means relative
// to confidence.js's mapping.
const CHECK_PATH = '/api/v2/check';
const MAX_AGE_DAYS = 90;

const mapCategoriesFromReports = (reports = []) => {
  // AbuseIPDB reports carry numeric category ids (their own taxonomy, e.g.
  // 18=Brute-Force, 21=Web App Attack) — reports.length is the only field
  // /check reliably includes at the free tier; a full category mapping
  // needs paid-tier report detail this integration doesn't call. Rather
  // than fabricate categories the provider hasn't actually established
  // (spec section 22: "do not claim a category the provider does not
  // actually establish"), this stays empty unless a future upgrade adds
  // real per-category evidence.
  return [];
};

const buildAbuseIpDbProvider = (config) => {
  const baseUrl = config.abuseIpDbBaseUrl || 'https://api.abuseipdb.com';
  const timeoutMs = config.abuseIpDbTimeoutMs || 5000;

  return {
    enabled: true,
    name: 'abuseipdb',

    // ip: already-normalized, already-confirmed-public (callers — see
    // threatIntelService.js — filter private/reserved IPs BEFORE this is
    // ever invoked; this function does not re-check, trusting its caller
    // the same way every other single-responsibility module in this phase
    // does).
    async lookupIndicator(ip) {
      const url = `${baseUrl}${CHECK_PATH}?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=${MAX_AGE_DAYS}`;
      const startedAt = Date.now();

      let res;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: {
            Key: config.abuseIpDbApiKey, // NEVER logged — see the catch blocks and the log line below, neither includes headers
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
        logger.warn({ errType: err.name, isTimeout, latencyMs: Date.now() - startedAt }, 'abuseipdb_request_failed');
        return {
          ok: false, reason: isTimeout ? 'timeout' : 'network_error', status: null, rateLimit: null,
        };
      }

      const latencyMs = Date.now() - startedAt;
      const rateLimit = {
        limit: res.headers.get('x-ratelimit-limit') ? Number(res.headers.get('x-ratelimit-limit')) : null,
        remaining: res.headers.get('x-ratelimit-remaining') ? Number(res.headers.get('x-ratelimit-remaining')) : null,
        retryAfterSeconds: res.headers.get('retry-after') ? Number(res.headers.get('retry-after')) : null,
      };

      if (res.status === 429) {
        logger.warn({ latencyMs, rateLimit }, 'abuseipdb_rate_limited');
        return {
          ok: false, reason: 'rate_limited', status: 429, rateLimit,
        };
      }
      if (res.status >= 500) {
        logger.warn({ latencyMs, status: res.status }, 'abuseipdb_server_error');
        return {
          ok: false, reason: 'server_error', status: res.status, rateLimit,
        };
      }
      if (!res.ok) {
        // 401/422/etc — a config or request-shape problem, not a transient
        // outage; still surfaced as a normal failure (never thrown), so a
        // misconfigured key degrades to UNKNOWN everywhere rather than
        // crashing every request that would have triggered a lookup.
        logger.warn({ latencyMs, status: res.status }, 'abuseipdb_request_rejected');
        return {
          ok: false, reason: 'rejected', status: res.status, rateLimit,
        };
      }

      let body;
      try {
        body = await res.json();
      } catch (err) {
        logger.warn({ latencyMs }, 'abuseipdb_malformed_response');
        return {
          ok: false, reason: 'malformed_response', status: res.status, rateLimit,
        };
      }

      const data = body?.data;
      if (!data || typeof data.abuseConfidenceScore !== 'number') {
        logger.warn({ latencyMs }, 'abuseipdb_malformed_response');
        return {
          ok: false, reason: 'malformed_response', status: res.status, rateLimit,
        };
      }

      const confidence = normalizeAbuseIpDbConfidence(data.abuseConfidenceScore);
      // AbuseIPDB itself doesn't return a boolean "malicious" — this
      // project's own threshold: >0 credible-report confidence is treated
      // as a MALICIOUS verdict (vs CLEAN), consistent with confidence.js's
      // severityFor mapping starting real severity at confidence>=31 while
      // still recording the exact score either way. isWhitelisted (an
      // AbuseIPDB field marking known-benign infrastructure, e.g. major
      // public DNS) overrides this to CLEAN regardless of score — the
      // provider's own explicit "this is not a threat" signal.
      const malicious = !data.isWhitelisted && confidence > 0;

      logger.info({ latencyMs, confidence, malicious }, 'abuseipdb_lookup_completed');

      return {
        ok: true,
        rateLimit,
        found: true,
        malicious,
        confidence,
        severity: severityFor(malicious ? 'MALICIOUS' : 'CLEAN', confidence),
        categories: mapCategoriesFromReports(data.reports),
        source: 'abuseipdb',
        sourceId: null,
        metadata: {
          // Deliberately small — never the raw response body (spec section
          // 4). countryCode/isp/domain are AbuseIPDB's own low-sensitivity
          // enrichment fields, not anything from the requester side.
          countryCode: data.countryCode || null,
          isTor: !!data.isTor,
          totalReports: data.totalReports || 0,
          isWhitelisted: !!data.isWhitelisted,
        },
      };
    },
  };
};

module.exports = { buildAbuseIpDbProvider };
