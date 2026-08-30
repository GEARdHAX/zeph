const { lookup } = require('./threatIntelService');
const logger = require('../../logger');

// Which SecurityEvent types are worth a threat-intel lookup on their source
// IP, and at what priority (spec sections 16/18/19 of the base spec, plus
// the hardening addendum's explicit priority system). Deliberately NOT
// every event type — an "ordinary successful request" (a normal login, a
// message send, a presence update) never triggers a real provider call;
// LOGIN_SUCCESS still gets a priority here so a normal login DOES benefit
// from an already-cached verdict (near-zero cost, cache-first per
// threatIntelService.js) without ever being the reason a NEW provider call
// happens (LOW priority skips the provider outright on a cache miss).
const ENRICHABLE_EVENT_PRIORITY = Object.freeze({
  LOGIN_SUCCESS: 'LOW',
  LOGIN_FAILED: 'HIGH',
  RATE_LIMIT_TRIGGERED: 'HIGH',
  UNAUTHORIZED_ACCESS: 'MEDIUM',
  PERMISSION_DENIED: 'MEDIUM',
  FILE_UPLOAD_REJECTED: 'MEDIUM',
  // Phase 4 — eBPF-observed outbound connections (see
  // routes/security/sensor-events.js). NETWORK_ANOMALY already implies a
  // sensor-side rule flagged it, so it's worth a real lookup; a plain
  // NETWORK_CONNECTION is LOW like LOGIN_SUCCESS — benefits from an
  // already-cached verdict without itself spending provider quota.
  NETWORK_CONNECTION: 'LOW',
  NETWORK_ANOMALY: 'HIGH',
  // Phase 5's NETWORK_FLOW/DNS_QUERY are deliberately NOT added here —
  // services/networkIntel/networkRules.js already runs its own threat-intel
  // correlation for every flow/DNS query it evaluates (with its own
  // priority-escalation logic: LOW normally, HIGH when another rule already
  // fired for the same flow) and emits a dedicated
  // THREAT_INTEL_NETWORK_MATCH event, matching spec section 44's own
  // worked example. Adding them here too would mean two independent
  // ThreatIntelService calls per flow (wasteful, even cache-backed) and two
  // different representations of the same fact (a metadata annotation
  // here, a whole separate event there) — one integration point per event
  // family, not both.
});

// Never re-enrich threat-intel's OWN events — would be circular (a
// THREAT_INTEL_MATCH event enriching itself) and pointless (its metadata
// already IS threat-intel data).
const NEVER_ENRICH = new Set(['THREAT_INTEL_MATCH', 'THREAT_INTEL_LOOKUP_FAILED', 'THREAT_INTEL_RATE_LIMITED']);

const shouldEnrich = (type) => !NEVER_ENRICH.has(type) && Object.prototype.hasOwnProperty.call(ENRICHABLE_EVENT_PRIORITY, type);

// Called by securityEventService.js's record() AFTER the event is already
// persisted — fire-and-forget, exactly like record() itself, so a slow/
// failed threat-intel lookup can never delay or fail the security event it
// enriches. Updates the SAME document's metadata.threatIntelligence once
// the lookup resolves, rather than blocking the original write for it.
const enrichSecurityEvent = async (savedEvent) => {
  if (!savedEvent || !shouldEnrich(savedEvent.type)) return;
  // Normally "who sent this HTTP request" (source.ip). eBPF NETWORK_* events
  // have no HTTP requester at all — the address worth checking is the
  // sensor's OBSERVED destination (metadata.network.destinationIp, set by
  // sensor-events.js), which is a genuinely different thing (an outbound
  // connection the host made), so it's read as a distinct fallback, not
  // conflated with source.ip.
  const ip = savedEvent.source?.ip || savedEvent.metadata?.network?.destinationIp;
  if (!ip) return; // nothing to look up — most non-network-originated events (e.g. a background job) have no IP at all

  const priority = ENRICHABLE_EVENT_PRIORITY[savedEvent.type];

  try {
    const result = await lookup(ip, { type: 'IP', priority, requestId: savedEvent.requestId });
    // A lookup that never reached a real verdict (private IP, disabled
    // provider, quota exhausted, LOW-priority skip) still enriches — with
    // an honest "we don't know" shape, never omitted, so a viewer can't
    // mistake "never enriched" for "confirmed clean."
    const threatIntelligence = {
      matched: result.malicious === true,
      indicatorType: result.type,
      confidence: result.confidence,
      severity: result.severity,
      source: result.source,
      checked: result.metadata?.reason !== 'invalid_indicator', // whether a real lookup attempt happened at all
    };

    // eslint-disable-next-line global-require
    const SecurityEvent = require('../../models/SecurityEvent');
    await SecurityEvent.updateOne(
      { eventId: savedEvent.eventId },
      { $set: { 'metadata.threatIntelligence': threatIntelligence } },
    );
  } catch (err) {
    // Enrichment failing must never be treated as the original security
    // event failing — it already happened and was already recorded.
    logger.warn({ err, eventId: savedEvent.eventId }, 'security_event_enrichment_failed');
  }
};

module.exports = { enrichSecurityEvent, shouldEnrich, ENRICHABLE_EVENT_PRIORITY };
