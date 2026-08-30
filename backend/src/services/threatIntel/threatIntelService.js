const ThreatIndicator = require('../../models/ThreatIndicator');
const logger = require('../../logger');
const store = require('../../store');
const {
  IndicatorTypes, normalizeIndicator, isPrivateOrReservedIp, indicatorKey,
} = require('./indicators');
const { getCachedThreatResult, setCachedThreatResult } = require('./cache');
const { tryAcquireLock, releaseLock, waitForResult } = require('./singleFlight');
const { checkAndReserveBudget, recordProviderRateLimit } = require('./quota');
const { buildCircuitBreaker } = require('./circuitBreaker');
const { getProvider } = require('./provider');
const SecurityEventService = require('../securityEventService');

// One breaker per process, shared across every lookup — see
// circuitBreaker.js's own header comment on why this is in-process state,
// not Redis-backed. `let`, not `const` — resetBreakerForTests() below
// reassigns it; every reference to `breaker` elsewhere in this file reads
// the current binding, not a captured snapshot, so the reassignment is
// visible everywhere immediately (ordinary JS closure semantics, not a
// mutation trick).
let breaker = buildCircuitBreaker();

// Test-only escape hatch — the breaker is deliberately shared module-level
// state (see above), so tests that trip it need a way back to CLOSED
// without reloading the whole module tree (which would also lose the
// jest.mock'd provider reference — see threatIntelService.test.js).
const resetBreakerForTests = () => { breaker = buildCircuitBreaker(); };

// UNKNOWN is the safe, honest default for every path that does NOT reach a
// real provider verdict — spec section 15's central rule ("provider
// unavailable != CLEAN") is enforced by never returning anything else here.
const unknownResult = (reason) => ({
  found: false, malicious: false, confidence: 0, severity: 'low', categories: [], source: 'unknown', metadata: { reason },
});

const toCacheableResult = (providerResult) => ({
  malicious: providerResult.malicious,
  confidence: providerResult.confidence,
  severity: providerResult.severity,
  categories: providerResult.categories,
  source: providerResult.source,
  metadata: providerResult.metadata,
  checkedAt: new Date().toISOString(),
});

// Persists/updates the ThreatIndicator document — upsert on the
// (normalizedIndicator, type) unique index (spec section 12: MongoDB as
// persistent intelligence, one row per indicator, not a new row per check).
const persistIndicator = async ({
  rawIndicator, normalized, type, cacheableResult, ttlSeconds,
}) => {
  const now = new Date();
  const status = cacheableResult.malicious ? 'MALICIOUS' : 'CLEAN';
  try {
    await ThreatIndicator.findOneAndUpdate(
      { normalizedIndicator: normalized, type },
      {
        $set: {
          indicator: rawIndicator,
          status,
          confidence: cacheableResult.confidence,
          severity: cacheableResult.severity,
          categories: cacheableResult.categories,
          source: cacheableResult.source,
          lastSeen: now,
          expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
          lifecycle: 'ACTIVE',
          metadata: cacheableResult.metadata,
          updatedAt: now,
        },
        $setOnInsert: { firstSeen: now },
      },
      { upsert: true },
    );
  } catch (err) {
    // Persistence failure never fails the lookup itself — the caller
    // already has the answer (from cache or the provider call that just
    // completed); losing the Mongo write only means this pass's result
    // isn't durably recorded, not that the risk-scoring decision fails.
    logger.warn({ err, normalized, type }, 'threatintel_persist_failed');
  }
};

// Core lookup — validate, normalize, check cache, single-flight-coordinate
// a miss, respect quota/circuit-breaker, call the provider, normalize +
// cache + persist the result. Returns the SAME normalized shape regardless
// of which path answered it (cache hit, provider call, or a safe fallback).
//
// options.priority (spec section 18): 'LOW' skips the provider entirely on
// a cache miss (returns UNKNOWN rather than spending quota) — callers pass
// this for indicators that don't warrant spending the scarce external
// budget (see securityEventEnrichment.js's own priority decision).
const lookup = async (rawIndicator, { type: hintedType, priority = 'MEDIUM', requestId } = {}) => {
  const normalizedResult = normalizeIndicator(rawIndicator, hintedType);
  if (!normalizedResult) {
    return { ...unknownResult('invalid_indicator'), indicator: rawIndicator };
  }
  const { type, normalized } = normalizedResult;

  // Private/reserved IPs never leave this process (spec section 27/17) —
  // returned as a clean, non-alarming UNKNOWN-shaped result, never sent to
  // the cache/provider pipeline at all (nothing worth caching either — the
  // answer is always the same for a given private address).
  if (type === IndicatorTypes.IP && isPrivateOrReservedIp(normalized)) {
    return {
      ...unknownResult('private_or_reserved_ip'), indicator: rawIndicator, normalizedIndicator: normalized, type,
    };
  }

  const key = indicatorKey(type, normalized);

  const cached = await getCachedThreatResult(key);
  if (cached) {
    return {
      ...cached, indicator: rawIndicator, normalizedIndicator: normalized, type, cacheHit: true,
    };
  }

  // AbuseIPDB (this phase's only real provider) is IP-only — spec section
  // 6/30 of the base spec: "only integrate with events that actually
  // expose meaningful indicators." A DOMAIN/URL/HASH lookup on a cache miss
  // has nowhere real to go yet; returning UNKNOWN here (not attempting a
  // provider call that would just come back found:false anyway) avoids
  // spending a lock/quota cycle on a request the provider can never answer.
  if (type !== IndicatorTypes.IP) {
    return {
      ...unknownResult('no_provider_for_type'), indicator: rawIndicator, normalizedIndicator: normalized, type,
    };
  }

  if (priority === 'LOW') {
    return {
      ...unknownResult('low_priority_skip'), indicator: rawIndicator, normalizedIndicator: normalized, type,
    };
  }

  // Single-flight: only one concurrent miss for the same key actually
  // calls the provider (spec sections 7-8) — everyone else waits briefly
  // for that one call's result, or falls through to a safe UNKNOWN if it
  // takes too long, rather than each independently hitting AbuseIPDB.
  // undefined (not null) means Redis isn't configured at all — no lock
  // exists for anyone to be holding, so there's nothing worth waiting for;
  // proceed straight to the provider call, quota/circuit-breaker gated the
  // same as always (see singleFlight.js's tryAcquireLock for the null-vs-
  // undefined distinction this branches on).
  const lockToken = await tryAcquireLock(key);
  if (lockToken === null) {
    const waited = await waitForResult(key, getCachedThreatResult);
    if (waited) {
      return {
        ...waited, indicator: rawIndicator, normalizedIndicator: normalized, type, cacheHit: true, coalesced: true,
      };
    }
    // Timed out waiting — proceed WITHOUT the lock rather than block this
    // request indefinitely. Falls through to the same quota/circuit-
    // breaker-gated path below; if another lookup is STILL in flight this
    // may occasionally result in two provider calls for the same key
    // during a true stampede's tail end — an accepted, bounded cost
    // against ever blocking a user-facing request past WAIT_TIMEOUT_MS.
    return performProviderLookup({
      rawIndicator, normalized, type, key, priority, requestId,
    });
  }

  try {
    return await performProviderLookup({
      rawIndicator, normalized, type, key, priority, requestId,
    });
  } finally {
    await releaseLock(key, lockToken);
  }
};

// eslint-disable-next-line no-use-before-define
async function performProviderLookup({
  rawIndicator, normalized, type, key, requestId,
}) {
  const config = store.config || {};
  const provider = getProvider(config);

  if (!provider.enabled) {
    return {
      ...unknownResult('provider_disabled'), indicator: rawIndicator, normalizedIndicator: normalized, type,
    };
  }

  if (!breaker.canAttempt()) {
    logger.info({ normalized }, 'threatintel_circuit_open_skip');
    return {
      ...unknownResult('circuit_open'), indicator: rawIndicator, normalizedIndicator: normalized, type,
    };
  }

  const budget = await checkAndReserveBudget(config.abuseIpDbDailyBudget);
  if (!budget.allowed) {
    SecurityEventService.record({
      type: 'THREAT_INTEL_RATE_LIMITED',
      severity: 'medium',
      source: {},
      target: { resource: 'threat_intelligence', action: 'lookup' },
      result: 'blocked',
      metadata: { reason: 'local_budget_exhausted' },
      requestId,
    });
    return {
      ...unknownResult('quota_exhausted'), indicator: rawIndicator, normalizedIndicator: normalized, type,
    };
  }

  const providerResult = await provider.lookupIndicator(normalized);
  recordProviderRateLimit(providerResult.rateLimit);

  if (!providerResult.ok) {
    breaker.recordFailure(providerResult.reason);
    SecurityEventService.record({
      type: 'THREAT_INTEL_LOOKUP_FAILED',
      severity: 'low',
      source: {},
      target: { resource: 'threat_intelligence', action: 'lookup' },
      result: 'failure',
      metadata: { reason: providerResult.reason },
      requestId,
    });
    // A failure IS itself cached, briefly — spec's own negative-caching
    // principle extended to failures: a provider outage must not mean
    // every single request for the same indicator re-attempts a call
    // (and re-fails the circuit breaker's counting) for the outage's
    // whole duration. Short TTL (60s) — long enough to shed a burst during
    // a real outage, short enough that a recovered provider is retried
    // again soon.
    const failureResult = { ...unknownResult(providerResult.reason), source: 'unknown' };
    await setCachedThreatResult(key, failureResult, 60);
    return {
      ...failureResult, indicator: rawIndicator, normalizedIndicator: normalized, type,
    };
  }

  breaker.recordSuccess();
  const cacheableResult = toCacheableResult(providerResult);
  const ttlSeconds = config.threatIntelCacheTtlSeconds || 6 * 60 * 60;
  await setCachedThreatResult(key, cacheableResult, ttlSeconds);
  await persistIndicator({
    rawIndicator, normalized, type, cacheableResult, ttlSeconds,
  });

  if (providerResult.malicious) {
    SecurityEventService.record({
      type: 'THREAT_INTEL_MATCH',
      severity: providerResult.severity,
      source: {},
      target: { resource: 'threat_intelligence', resourceId: normalized, action: 'lookup' },
      result: 'success',
      metadata: {
        indicatorType: type, confidence: providerResult.confidence, source: providerResult.source,
      },
      requestId,
    });
  }

  return {
    ...cacheableResult, indicator: rawIndicator, normalizedIndicator: normalized, type, cacheHit: false,
  };
}

// breaker exposed as a live getter (not a captured reference) — see
// resetBreakerForTests above for why a plain `{ breaker }` export would go
// stale the instant a test resets it.
module.exports = {
  lookup, resetBreakerForTests, get breaker() { return breaker; },
};
