// AI priority classification (spec section 23) — deterministic, cheap,
// decides whether an incident is even WORTH an AI call at all, and if so
// how urgently. "Not every event requires AI" (spec's own opening line) —
// a single low-severity signal never triggers analysis on its own.
//
// BullMQ priority convention: LOWER number = processed FIRST. Mapped here
// so callers work with the spec's own CRITICAL/HIGH/MEDIUM/LOW vocabulary
// and never need to know BullMQ's inverted numeric scale.
const PRIORITY_VALUES = Object.freeze({
  CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4,
});

// Returns null when the incident is NOT worth an AI call at all (spec's
// own example: "single normal login -> no AI"); otherwise one of
// PRIORITY_VALUES' keys.
const classifyIncidentPriority = (incident) => {
  const signalCount = incident.signals?.length || 0;
  const hasMaliciousIp = incident.signals?.includes('malicious_ip');
  const hasProcessAnomaly = incident.signals?.includes('process_anomaly');
  const hasScanOrExfil = incident.signals?.some((s) => ['port_scan', 'host_scan', 'possible_exfiltration'].includes(s));

  if (signalCount === 0) return null; // nothing correlated yet — should not happen in practice (correlateEvent always adds at least one signal), defensive

  // "Multiple correlated anomalies" (spec's own CRITICAL example)
  if (signalCount >= 3) return 'CRITICAL';

  // "eBPF process anomaly + malicious network destination -> AI useful" (spec's own HIGH example)
  if (hasProcessAnomaly && hasMaliciousIp) return 'HIGH';
  if (hasScanOrExfil && hasMaliciousIp) return 'HIGH';

  // "Repeated authentication attack -> AI useful" / any single scan-shaped
  // or malicious-IP signal on its own, without correlation yet
  if (hasScanOrExfil || hasMaliciousIp || hasProcessAnomaly) return 'MEDIUM';

  // A single low-severity signal (e.g. one NETWORK_ANOMALY "unusual
  // destination") — worth recording, not worth an AI call yet.
  return null;
};

module.exports = { classifyIncidentPriority, PRIORITY_VALUES };
