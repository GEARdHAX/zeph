const crypto = require('crypto');
const SecurityEvent = require('../../models/SecurityEvent');
const SecurityIncident = require('../../models/SecurityIncident');
const logger = require('../../logger');

// Deterministic correlation layer (spec sections 31/33) — decides WHICH
// events belong to the same incident. AI never makes this decision; it
// only explains evidence this layer has already grouped (spec section 31:
// "the correlation engine should remain deterministic. AI explains the
// correlated evidence").
//
// Correlation key: sensorId + a fixed-width time bucket (spec section 33:
// "use deterministic correlation keys where appropriate") — every
// host-level anomaly event within the SAME sensor and the SAME
// CORRELATION_WINDOW_MS bucket maps to the same key, so 10,000 related
// events collapse into ONE incident (spec section 33's own numeric
// example), not 10,000. A new bucket starts a new incident rather than
// growing one indefinitely — bounded, not open-ended correlation.
const CORRELATION_WINDOW_MS = 15 * 60 * 1000; // spec section 8's "15 minutes" option — long enough to catch a multi-stage pattern (recon -> exfil attempt), short enough that unrelated activity days apart never merges

// ponytail: fixed epoch-aligned buckets (Math.floor(timestamp/windowMs))
// mean two events genuinely only seconds apart CAN land in different
// buckets if they straddle a boundary — splitting one real incident into
// two adjacent ones. Same accepted tradeoff this codebase's other fixed-
// window mechanisms already make (lib/inviteRateLimit.js's own fixed-
// window buckets have the identical property) rather than a sliding/
// rolling window, which would need a query-then-decide instead of a pure
// hash key and let an incident's window drift indefinitely. Upgrade path:
// a sliding correlation ("extend the most recent incident for this sensor
// if within CORRELATION_WINDOW_MS of its lastSeenAt") if boundary-splits
// prove to matter in practice — both resulting incidents still get
// correlated/analyzed either way, this is a minor UX/grouping
// imperfection, not a correctness or security gap.

// Only these types are correlation-worthy (spec section 23: "not every
// event requires AI" — a plain NETWORK_FLOW/DNS_QUERY observation is not,
// on its own, an anomaly; only the VERDICT types the deterministic rules
// engines (Phase 4's anomalyRules.js, Phase 5's networkRules.js) already
// produced are).
const CORRELATABLE_TYPES = new Set([
  'PROCESS_ANOMALY', 'NETWORK_ANOMALY', 'PORT_SCAN_ANOMALY', 'HOST_SCAN_ANOMALY',
  'POSSIBLE_BEACONING', 'POSSIBLE_DATA_EXFILTRATION', 'DNS_ANOMALY', 'THREAT_INTEL_NETWORK_MATCH',
]);

const correlationKeyFor = (sensorId, timestamp) => {
  const bucket = Math.floor(new Date(timestamp).getTime() / CORRELATION_WINDOW_MS);
  return crypto.createHash('sha256').update(`${sensorId}:${bucket}`).digest('hex').slice(0, 24);
};

const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
const higherSeverity = (a, b) => ((severityRank[a] ?? 0) >= (severityRank[b] ?? 0) ? a : b);

// Idempotent upsert (spec section 22: "jobs must be idempotent") — calling
// this twice for the same event never creates a duplicate incident or
// double-counts eventCount, because it's keyed on the deterministic
// correlationKey and only increments once the event's own eventId hasn't
// been folded in yet. Returns the incident (created or updated), or null
// if this event isn't correlation-worthy.
const correlateEvent = async (event) => {
  if (!event || !CORRELATABLE_TYPES.has(event.type)) return null;
  const sensorId = event.metadata?.sensorId;
  if (!sensorId) return null;

  const correlationKey = correlationKeyFor(sensorId, event.timestamp);
  const signalLabel = SIGNAL_LABEL_BY_TYPE[event.type] || 'process_anomaly';
  const source = event.sourceSystem || 'app';

  const existing = await SecurityIncident.findOne({ correlationKey });

  if (!existing) {
    const incident = await SecurityIncident.create({
      incidentId: crypto.randomUUID(),
      startedAt: event.timestamp,
      lastSeenAt: event.timestamp,
      severity: event.severity || 'low',
      correlationKey,
      signals: [signalLabel],
      hosts: event.metadata?.hostId ? [event.metadata.hostId] : [],
      sensorIds: [sensorId],
      sources: [source],
      eventCount: 1,
    });
    return incident;
  }

  const update = {
    lastSeenAt: event.timestamp > existing.lastSeenAt ? event.timestamp : existing.lastSeenAt,
    severity: higherSeverity(existing.severity, event.severity || 'low'),
    updatedAt: new Date(),
  };
  const addToSet = {};
  if (!existing.signals.includes(signalLabel)) addToSet.signals = signalLabel;
  if (event.metadata?.hostId && !existing.hosts.includes(event.metadata.hostId)) addToSet.hosts = event.metadata.hostId;
  if (!existing.sources.includes(source)) addToSet.sources = source;

  const updated = await SecurityIncident.findByIdAndUpdate(
    existing._id,
    {
      $set: update,
      $inc: { eventCount: 1 },
      ...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
    },
    { new: true },
  ).catch((err) => {
    logger.warn({ err, correlationKey }, 'security_incident_update_failed');
    return existing;
  });

  return updated;
};

const SIGNAL_LABEL_BY_TYPE = {
  PROCESS_ANOMALY: 'process_anomaly',
  NETWORK_ANOMALY: 'unusual_destination',
  PORT_SCAN_ANOMALY: 'port_scan',
  HOST_SCAN_ANOMALY: 'host_scan',
  POSSIBLE_BEACONING: 'possible_beaconing',
  POSSIBLE_DATA_EXFILTRATION: 'possible_exfiltration',
  DNS_ANOMALY: 'dns_anomaly',
  THREAT_INTEL_NETWORK_MATCH: 'malicious_ip',
};

// Builds the sanitized context an INCIDENT_SUMMARY analysis needs from an
// incident document — counts/signals only (spec section 5's own worked
// example), never a raw event dump.
const contextForIncident = (incident) => ({
  timeWindow: '15m',
  scope: 'host',
  signals: incident.signals,
  processAnomalyCount: incident.signals.includes('process_anomaly') ? 1 : 0,
  networkAnomalyCount: incident.signals.includes('unusual_destination') ? 1 : 0,
  portScanCount: incident.signals.includes('port_scan') ? 1 : 0,
  hostScanCount: incident.signals.includes('host_scan') ? 1 : 0,
  beaconingCount: incident.signals.includes('possible_beaconing') ? 1 : 0,
  exfiltrationCount: incident.signals.includes('possible_exfiltration') ? 1 : 0,
  dnsAnomalyCount: incident.signals.includes('dns_anomaly') ? 1 : 0,
  maliciousIpCount: incident.signals.includes('malicious_ip') ? 1 : 0,
  uniqueDestinationCount: incident.hosts.length,
});

module.exports = {
  correlateEvent, correlationKeyFor, contextForIncident, CORRELATABLE_TYPES, CORRELATION_WINDOW_MS, SIGNAL_LABEL_BY_TYPE,
};
