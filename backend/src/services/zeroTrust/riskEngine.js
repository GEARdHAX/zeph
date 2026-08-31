const SecurityEvent = require('../../models/SecurityEvent');
const logger = require('../../logger');
const { RISK_WEIGHTS, riskLevelFor } = require('./riskWeights');
const { getCachedRiskContext } = require('./riskCache');
// Phase 3 — Threat Intelligence signal (spec section 24 of the Phase 3
// spec: "Threat Intelligence must remain a signal provider... never
// hardcode threat intelligence as an automatic DENY"). Deferred require —
// same circular-require reasoning as securityEventService.js's own hook
// into threatIntel/securityEventEnrichment.js (threatIntelService.js's
// THREAT_INTEL_* events flow back through SecurityEventService, which
// nothing in THIS file's own require graph touches, but the deferred
// pattern is kept consistent across every Phase 3 integration point rather
// than mixing top-level and deferred requires arbitrarily).
const getThreatIntelLookup = () => require('../threatIntel/threatIntelService').lookup; // eslint-disable-line global-require
// Phase 6 — AI authentication-anomaly signal (spec section 24). Deferred,
// same reasoning as the threat-intel require above.
const getAiCache = () => require('../securityAi/cache'); // eslint-disable-line global-require

// How far back "recent" looks for behavioral signals (failed logins,
// permission denials, rate-limit trips) — long enough to catch a real
// credential-stuffing/probing burst, short enough that a mistake from
// yesterday doesn't keep inflating risk today.
const LOOKBACK_MS = 30 * 60 * 1000; // 30 minutes

// A session younger than this is "new" for risk purposes — see
// riskEngine.js's own comment block below for why session age doubles as
// the "known vs unknown device" signal (no separate Device model exists;
// Session._id already IS the deviceId per the existing JWT/passport
// convention — see Session.js, init.js).
const NEW_SESSION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Deterministic-only (spec section 11/13/33) — no AI, no ML, no external
// signal. Every factor here is computed from data ZEPH already has: the
// Session document's own age (createdAt) as the device/session-known
// signal, and counts of the caller's OWN recent SecurityEvent documents
// (never another user's — see zeroTrustPolicyEngine.js's tests) for
// behavioral signals. This intentionally reuses Phase 1's SecurityEvent
// history as the risk engine's data source, per this phase's spec section 2
// ("Existing security controls produce signals; Zero Trust consumes those
// signals") — no parallel event log, no duplicate counters.
const computeRiskFactors = async ({ userId, session, ip }) => {
  const factors = [];
  let score = 0;

  const addFactor = (type, weight, detail) => {
    factors.push({ type, weight, ...detail });
    score += weight;
  };

  // Device/session-known signal — session age is the only device-continuity
  // data that actually exists (spec section 9: "if ZEPH already has a
  // device identifier, reuse it... do NOT create invasive fingerprinting").
  // No session at all (a legacy pre-device-session token, or a request this
  // middleware couldn't resolve one for) is treated as unknown-device,
  // never known — fail toward MORE scrutiny, not less, matching section 30's
  // "when in doubt, do not silently grant elevated access."
  if (!session) {
    addFactor('UNKNOWN_DEVICE', RISK_WEIGHTS.UNKNOWN_DEVICE, { reason: 'no_session_context' });
  } else {
    const ageMs = Date.now() - new Date(session.createdAt).getTime();
    if (session.revokedAt) {
      addFactor('REVOKED_SESSION', RISK_WEIGHTS.REVOKED_SESSION, {});
    } else if (ageMs < NEW_SESSION_THRESHOLD_MS) {
      addFactor('NEW_SESSION', RISK_WEIGHTS.NEW_SESSION, { sessionAgeMs: ageMs });
      addFactor('UNKNOWN_DEVICE', RISK_WEIGHTS.UNKNOWN_DEVICE, { reason: 'session_too_new' });
    } else {
      addFactor('KNOWN_DEVICE', RISK_WEIGHTS.KNOWN_DEVICE, { sessionAgeMs: ageMs });
    }
  }

  if (userId) {
    const since = new Date(Date.now() - LOOKBACK_MS);
    // One aggregate query, not three separate countDocuments() round trips
    // — matters here since this runs on every sensitive request that misses
    // cache (see riskCache.js's TTL). $group in a single pass keeps this to
    // one index-backed query against actor.userId+timestamp (already
    // indexed by SecurityEvent.js from Phase 1).
    const counts = await SecurityEvent.aggregate([
      { $match: { 'actor.userId': userId, timestamp: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    const countByType = Object.fromEntries(counts.map((c) => [c._id, c.count]));

    if (countByType.LOGIN_FAILED >= 3) {
      addFactor('RECENT_FAILED_LOGINS', RISK_WEIGHTS.RECENT_FAILED_LOGINS, { count: countByType.LOGIN_FAILED });
    }
    if (countByType.PERMISSION_DENIED >= 1 || countByType.UNAUTHORIZED_ACCESS >= 1) {
      addFactor('RECENT_PERMISSION_DENIED', RISK_WEIGHTS.RECENT_PERMISSION_DENIED, {
        count: (countByType.PERMISSION_DENIED || 0) + (countByType.UNAUTHORIZED_ACCESS || 0),
      });
    }
    if (countByType.RATE_LIMIT_TRIGGERED >= 1) {
      addFactor('RATE_LIMIT_TRIGGERED', RISK_WEIGHTS.RATE_LIMIT_TRIGGERED, { count: countByType.RATE_LIMIT_TRIGGERED });
    }

    // Phase 6 — AI authentication-anomaly signal. Cache-read ONLY (spec
    // section 21: AI must never be triggered live from a code path that
    // runs on every sensitive request — same resource-exhaustion concern
    // the threat-intel LOW-priority-only rule further below already
    // addresses for AbuseIPDB, applied identically to Ollama). This reads
    // whatever securityAiService.js's own short-TTL Redis cache
    // (securityAi/cache.js) ALREADY holds for this exact context —
    // populated by an earlier ANOMALY-type analysis the BullMQ worker or
    // an admin's manual POST /api/security/ai/analyze call already ran —
    // and simply never contributes if nothing is cached (the
    // overwhelmingly common case). No new AI call is ever made from inside
    // computeRiskFactors.
    //
    // Deliberately scoped to userId-attributed data ONLY (the exact same
    // per-user aggregate already computed above), matching the honest
    // attribution boundary this function has drawn since Phase 4: AI's
    // analysis of HOST-level data (process/network/threat-intel
    // correlation) is not folded in here for the identical reason
    // PROCESS_ANOMALY/NETWORK_ANOMALY aren't — see the Phase 4/5 comment
    // block further below.
    try {
      const aiContext = {
        timeWindow: '5m',
        scope: 'user',
        failedLoginCount: countByType.LOGIN_FAILED || 0,
        rateLimitCount: countByType.RATE_LIMIT_TRIGGERED || 0,
      };
      // scopeId:userId — see securityAi/cache.js's own comment on the bug
      // this fixes (two different users with identical aggregate counts
      // must never share one cached AI verdict). userId itself is never
      // part of aiContext (never sent to the model), only mixed into the
      // Redis key.
      const cachedAiResult = await getAiCache().getCachedAnalysis('ANOMALY', aiContext, userId);
      // Confidence threshold (spec section 24: "AI anomaly confidence >
      // threshold -> bounded risk contribution") — a low-confidence "maybe"
      // contributes nothing; only a confident anomaly signal counts at
      // all, and even then only ever the ONE fixed, capped weight (never
      // scaled by confidence, never compounded by calling this twice —
      // spec section 25's "prevent AI risk amplification").
      if (cachedAiResult && cachedAiResult.anomalous && cachedAiResult.confidence >= 70) {
        addFactor('AI_AUTH_ANOMALY', RISK_WEIGHTS.AI_AUTH_ANOMALY, {
          confidence: cachedAiResult.confidence, analysisId: cachedAiResult.analysisId,
        });
      }
    } catch (err) {
      logger.warn({ err, userId }, 'risk_engine_ai_signal_read_failed');
    }
  }

  // Threat Intelligence signal (Phase 3) — cache-first, LOW priority: this
  // NEVER triggers a fresh external provider call on its own (a risk
  // evaluation runs on every sensitive request; spending AbuseIPDB quota
  // here would violate Phase 3's own "do not query threat intelligence for
  // ordinary requests" rule). It only benefits from a verdict some OTHER
  // trigger (securityEventEnrichment.js's LOGIN_FAILED/RATE_LIMIT_TRIGGERED
  // enrichment, or a prior HIGH/MEDIUM-priority lookup) already cached.
  // Avoiding double-counting (Phase 3 spec section 24): this factor is
  // computed once per computeRiskFactors() call, which itself only runs
  // once per riskCache.js TTL window (5 min) per session — 10,000 requests
  // from the same malicious IP during that window contribute this +40
  // exactly once, not 10,000 times, by construction (the cache, not this
  // function, is what prevents the multiplication).
  if (ip) {
    try {
      const lookup = getThreatIntelLookup();
      const threatResult = await lookup(ip, { type: 'IP', priority: 'LOW' });
      if (threatResult.malicious) {
        addFactor('MALICIOUS_IP', RISK_WEIGHTS.MALICIOUS_IP, {
          confidence: threatResult.confidence, source: threatResult.source,
        });
      }
    } catch (err) {
      // A threat-intel failure here must never fail the whole risk
      // evaluation (Phase 3 spec section 35: "provider failure should not
      // take down ZEPH... continue according to policy") — simply
      // contributes no signal, same as an UNKNOWN verdict would.
      logger.warn({ err, ip }, 'risk_engine_threat_intel_lookup_failed');
    }
  }

  // Phase 4 — eBPF PROCESS_ANOMALY/NETWORK_ANOMALY events are deliberately
  // NOT consumed here. Those events are host-observed (keyed by
  // sensorId/hostId — see routes/security/sensor-events.js), not
  // user-attributed: ZEPH has no user<->host mapping anywhere in its data
  // model, so there is no honest way to fold "host X saw an anomalous
  // process" into THIS particular user's per-request risk score without
  // fabricating a correlation that doesn't exist — exactly what the Phase 4
  // spec's own "do not fake it" instruction rules out. These events still
  // reach SecurityEvent (sourceSystem: 'ebpf') and the admin security view
  // for human review; they just don't feed this deterministic per-user
  // scoring function. Revisit only if/when ZEPH gains a real session<->host
  // binding (e.g. sessions pinned to a specific backend instance) that would
  // make the correlation genuine rather than assumed.
  //
  // Phase 5 — the SAME reasoning applies to PORT_SCAN_ANOMALY/
  // HOST_SCAN_ANOMALY/POSSIBLE_BEACONING/POSSIBLE_DATA_EXFILTRATION (spec
  // section 45's own example — "PROCESS_ANOMALY + NETWORK_ANOMALY +
  // MALICIOUS_IP -> stronger risk signal" — describes correlating events
  // that are ALL host/process-attributed against each other, which is
  // legitimate; it does not describe folding a host signal into a
  // particular HTTP-authenticated user's session risk, which would still
  // be the same fabricated correlation Phase 4 already declined to make).
  // What genuinely DOES reach this function already, with no new code:
  // THREAT_INTEL_NETWORK_MATCH shares the exact same ThreatIntelService
  // cache (see threatIntelService.js) the MALICIOUS_IP factor above already
  // queries by IP — if a destination the network sensor flagged happens to
  // be the SAME address as a user's own request IP, that cached MALICIOUS
  // verdict is picked up here automatically, through the shared cache, not
  // through any network-specific code added to this file. Cross-signal
  // correlation among Phase 4/5's own host-level events (spec section 25)
  // instead lives entirely within networkRules.js itself (e.g. escalating a
  // flow's threat-intel lookup to HIGH priority when a scan/exfil rule
  // already fired for it) — that is genuine correlation, computed where the
  // real host-level context actually exists.
  const clampedScore = Math.max(0, Math.min(100, score));
  return { score: clampedScore, level: riskLevelFor(clampedScore), factors };
};

// Public entry point — cached per session (spec section 31: "do not add
// expensive database queries to every request"). userId is included in the
// cache key indirectly (a session belongs to exactly one user, enforced at
// login), so no separate keying is needed.
const getRiskContext = ({ userId, session, ip }) => {
  const sessionId = session?._id?.toString();
  return getCachedRiskContext(sessionId, () => computeRiskFactors({ userId, session, ip }));
};

module.exports = { getRiskContext, computeRiskFactors, LOOKBACK_MS, NEW_SESSION_THRESHOLD_MS };
