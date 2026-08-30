const store = require('../../store');
const logger = require('../../logger');
const { SecurityEventTypes } = require('../../constants/securityEventTypes');
const { recordFlow } = require('./windowCounters');
const { recordDnsQuery } = require('./dnsCounters');
const { parseTrustedList, isTrustedDestination, isKnownCandidate } = require('./baseline');
const { looksRegular } = require('./beaconDetection');

// Deferred requires (SecurityEventService, ThreatIntelService) — same
// circular-require avoidance every Phase 3/4 integration point in this
// codebase already uses (see threatIntel/securityEventEnrichment.js,
// zeroTrust/riskEngine.js's own comments on this exact pattern).
const getSecurityEventService = () => require('../securityEventService'); // eslint-disable-line global-require
const getThreatIntelLookup = () => require('../threatIntel/threatIntelService').lookup; // eslint-disable-line global-require

const BEACON_MIN_OCCURRENCES = 3; // spec section 20 — "regular repeated intervals," 3 is the minimum needed to even measure a gap's regularity (2 points is always "regular," there's only one gap)

// Runs the Phase 5 deterministic rule set against ONE validated NETWORK_FLOW
// event (spec sections 17-21). Fire-and-forget from the caller (routes/
// security/sensor-events.js) — same posture as SecurityEventService.record()
// itself: a rules-engine hiccup must never fail sensor ingestion.
//
// This is the SINGLE authoritative place backend-computed network anomaly
// verdicts come from (spec section 36) — the sensor's own raw NETWORK_FLOW/
// DNS_QUERY events carry no severity/anomaly judgment at all (see
// sensorEventValidation.js), only what actually happened.
const evaluateFlow = async ({ sensorId, hostId, flow }) => {
  if (!store.config?.networkSensorEnabled) return;
  if (!Number.isInteger(flow?.pid)) return; // no process attribution -> nothing to correlate a scan/beacon/exfil pattern against; still a valid NETWORK_FLOW observation, just not rule-evaluable

  const windowMs = store.config.networkFlowWindowMs;
  const scanThreshold = store.config.networkScanThreshold;
  const beaconThreshold = store.config.networkBeaconThreshold;
  const exfilThresholdBytes = store.config.networkExfilThresholdBytes;

  const SecurityEventService = getSecurityEventService();

  const counters = await recordFlow({
    sensorId,
    pid: flow.pid,
    destinationIp: flow.destinationIp,
    destinationPort: flow.destinationPort,
    bytesSent: flow.bytesSent,
    windowMs,
  });

  const baseMetadata = {
    sensorId, hostId, process: { pid: flow.pid, name: flow.processName || null },
  };

  // Rule 2/18 — port scan: one process touching many distinct DESTINATION
  // PORTS within the window (classic single-host multi-port probe shape).
  if (store.config.networkBaselineEnabled !== false && counters.distinctPorts >= scanThreshold) {
    SecurityEventService.record({
      type: SecurityEventTypes.PORT_SCAN_ANOMALY,
      severity: 'high',
      target: { resource: 'network', action: 'port_scan_anomaly' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: { ...baseMetadata, distinctPorts: counters.distinctPorts, threshold: scanThreshold, windowMs },
    });
  }

  // Rule/§19 — host scan: one process touching many distinct DESTINATION
  // HOSTS within the window (network sweep shape, as opposed to port scan's
  // single-host-many-ports shape).
  if (counters.distinctHosts >= scanThreshold) {
    SecurityEventService.record({
      type: SecurityEventTypes.HOST_SCAN_ANOMALY,
      severity: 'high',
      target: { resource: 'network', action: 'host_scan_anomaly' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: { ...baseMetadata, distinctHosts: counters.distinctHosts, threshold: scanThreshold, windowMs },
    });
  }

  // §20 — beaconing: regular-interval repeated connections to the SAME
  // destination. Deliberately never labeled C2 — see beaconDetection.js.
  // beaconThreshold (config.networkBeaconThreshold, spec section 49) is how
  // many occurrences must be seen before regularity is even measured —
  // BEACON_MIN_OCCURRENCES is the hard floor beneath which "regular" is
  // mathematically meaningless (see beaconDetection.js), so the effective
  // minimum is whichever is larger.
  const beaconMinOccurrences = Math.max(BEACON_MIN_OCCURRENCES, beaconThreshold);
  if (flow.destinationIp && looksRegular(counters.beaconTimestamps, beaconMinOccurrences)) {
    SecurityEventService.record({
      type: SecurityEventTypes.POSSIBLE_BEACONING,
      severity: 'medium',
      target: { resource: 'network', action: 'possible_beaconing' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: {
        ...baseMetadata, destinationIp: flow.destinationIp, destinationPort: flow.destinationPort, occurrences: counters.beaconTimestamps.length, threshold: beaconMinOccurrences,
      },
    });
  }

  // §21 — possible data exfiltration: unusually large CUMULATIVE outbound
  // transfer to one destination within the window, AND that destination is
  // not a known/trusted one. Metadata-only (spec section 21: "do not
  // inspect payload contents... this is a heuristic, do not claim actual
  // data theft occurred").
  const trustedSet = parseTrustedList(store.config.networkBaselineTrusted);
  const trusted = isTrustedDestination(trustedSet, flow.destinationIp, flow.destinationPort);
  if (!trusted && counters.cumulativeBytes >= exfilThresholdBytes) {
    SecurityEventService.record({
      type: SecurityEventTypes.POSSIBLE_DATA_EXFILTRATION,
      severity: 'high',
      target: { resource: 'network', action: 'possible_data_exfiltration' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: {
        ...baseMetadata, destinationIp: flow.destinationIp, destinationPort: flow.destinationPort, cumulativeBytes: counters.cumulativeBytes, thresholdBytes: exfilThresholdBytes,
      },
    });
  }

  // §22-23 — unusual destination: neither trusted nor even a prior
  // candidate. Deliberately the LOWEST-severity signal here (an unrecognized
  // destination on its own is common and often benign — new deploy, new
  // third-party integration) — it exists to feed the risk engine a small
  // weight (see riskWeights.js), not to alarm on its own.
  if (store.config.networkBaselineEnabled && flow.destinationIp && !trusted) {
    const wasKnownCandidate = await isKnownCandidate(flow.destinationIp);
    if (!wasKnownCandidate) {
      SecurityEventService.record({
        type: SecurityEventTypes.NETWORK_ANOMALY,
        severity: 'low',
        target: { resource: 'network', action: 'unusual_destination' },
        result: 'unknown',
        sourceSystem: 'network_sensor',
        metadata: {
          ...baseMetadata, destinationIp: flow.destinationIp, destinationPort: flow.destinationPort, reason: 'unusual_destination',
        },
      });
    }
  }

  // §12/44 — threat intelligence correlation. LOW priority (never spends
  // provider quota on its own — same reasoning riskEngine.js's own
  // threat-intel call documents) EXCEPT when this exact flow already
  // triggered a rule above, in which case it's worth a real check (a
  // HIGH-priority lookup can still be served entirely from cache — priority
  // only affects whether a CACHE MISS is worth a fresh provider call).
  if (flow.destinationIp) {
    const anyRuleFired = counters.distinctPorts >= scanThreshold
      || counters.distinctHosts >= scanThreshold
      || counters.cumulativeBytes >= exfilThresholdBytes;
    try {
      const lookup = getThreatIntelLookup();
      const result = await lookup(flow.destinationIp, { type: 'IP', priority: anyRuleFired ? 'HIGH' : 'LOW' });
      if (result.malicious) {
        SecurityEventService.record({
          type: SecurityEventTypes.THREAT_INTEL_NETWORK_MATCH,
          severity: result.severity || 'high',
          target: { resource: 'network', action: 'threat_intel_network_match' },
          result: 'unknown',
          sourceSystem: 'network_sensor',
          metadata: {
            ...baseMetadata,
            destinationIp: flow.destinationIp,
            destinationPort: flow.destinationPort,
            confidence: result.confidence,
            source: result.source,
          },
        });
      }
    } catch (err) {
      logger.warn({ err, destinationIp: flow.destinationIp }, 'network_intel_threat_lookup_failed');
    }
  }
};

// DNS anomaly rules (spec section 11) — same fire-and-forget posture.
// "high NXDOMAIN volume -> DNS_ANOMALY", never "-> MALWARE" from one
// heuristic alone (spec's own explicit example) — the type name itself
// (DNS_ANOMALY, not e.g. DNS_MALWARE) is the enforcement of that rule.
const evaluateDnsQuery = async ({ sensorId, hostId, dns }) => {
  if (!store.config?.networkSensorEnabled || !store.config?.networkDnsAnalysisEnabled) return;
  if (!Number.isInteger(dns?.pid) || !dns?.domain) return;

  const SecurityEventService = getSecurityEventService();
  const windowMs = store.config.networkFlowWindowMs;
  const scanThreshold = store.config.networkScanThreshold; // reused — "many distinct domains" and "many distinct ports" are the same shape of signal (high-frequency enumeration), no separate DNS-specific threshold config needed for this pass

  const counters = await recordDnsQuery({
    sensorId, pid: dns.pid, domain: dns.domain, nxdomain: dns.nxdomain === true, windowMs,
  });

  const baseMetadata = { sensorId, hostId, process: { pid: dns.pid, name: dns.processName || null } };

  if (counters.distinctDomains >= scanThreshold) {
    SecurityEventService.record({
      type: SecurityEventTypes.DNS_ANOMALY,
      severity: 'medium',
      target: { resource: 'network', action: 'dns_high_volume' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: { ...baseMetadata, distinctDomains: counters.distinctDomains, threshold: scanThreshold, windowMs, reason: 'high_query_volume' },
    });
  }
  if (counters.nxdomainCount >= scanThreshold) {
    SecurityEventService.record({
      type: SecurityEventTypes.DNS_ANOMALY,
      severity: 'medium',
      target: { resource: 'network', action: 'dns_high_nxdomain' },
      result: 'unknown',
      sourceSystem: 'network_sensor',
      metadata: { ...baseMetadata, nxdomainCount: counters.nxdomainCount, threshold: scanThreshold, windowMs, reason: 'high_nxdomain_volume' },
    });
  }

  // §13 — domain threat intelligence, routed through the SAME centralized
  // ThreatIntelService (never a direct provider call). Honest limitation:
  // AbuseIPDB (this deployment's only real provider — see Phase 3) is
  // IP-only, so a DOMAIN-type lookup always returns UNKNOWN today
  // (no_provider_for_type) — this call is still wired through the real
  // service (satisfying "must flow through ThreatIntelService, never call
  // AbuseIPDB directly") so it activates for free the moment a future
  // domain-reputation provider is added, with zero changes needed here.
  try {
    const lookup = getThreatIntelLookup();
    const result = await lookup(dns.domain, { type: 'DOMAIN', priority: 'LOW' });
    if (result.malicious) {
      SecurityEventService.record({
        type: SecurityEventTypes.THREAT_INTEL_NETWORK_MATCH,
        severity: result.severity || 'high',
        target: { resource: 'network', action: 'threat_intel_domain_match' },
        result: 'unknown',
        sourceSystem: 'network_sensor',
        metadata: {
          ...baseMetadata, domain: dns.domain, confidence: result.confidence, source: result.source,
        },
      });
    }
  } catch (err) {
    logger.warn({ err, domain: dns.domain }, 'network_intel_dns_threat_lookup_failed');
  }
};

module.exports = { evaluateFlow, evaluateDnsQuery };
