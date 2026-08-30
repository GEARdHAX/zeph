const validator = require('validator');
const { SecurityEventTypes } = require('../../constants/securityEventTypes');

// Sensor-observation types this endpoint accepts — a subset of the full
// SecurityEventTypes taxonomy (spec section 33: "the sensor may provide
// observations; the backend calculates security context"). A sensor
// submitting LOGIN_FAILED or ZERO_TRUST_DENY would be nonsensical (those
// are backend-internal decisions, not host observations) — restricting the
// allowed set here is itself a security control, not just validation.
//
// Phase 5 (ebpf-sensor/) reuses this SAME allowlist/endpoint per its own
// spec section 34 ("do not create a second sensor credential system") —
// NETWORK_FLOW/DNS_QUERY are the two new raw-observation types it submits.
// PORT_SCAN_ANOMALY/HOST_SCAN_ANOMALY/POSSIBLE_BEACONING/
// POSSIBLE_DATA_EXFILTRATION/THREAT_INTEL_NETWORK_MATCH are deliberately
// NOT in this set — those are backend-COMPUTED verdicts (see
// services/networkIntel/networkRules.js), never something a sensor submits
// directly, for the same "backend calculates security context" reason
// PROCESS_ANOMALY's sensor-side rule (Phase 4) only ever produces evidence,
// not those specific escalated types.
const SENSOR_ALLOWED_TYPES = new Set([
  SecurityEventTypes.PROCESS_EXEC,
  SecurityEventTypes.PROCESS_EXIT,
  SecurityEventTypes.PROCESS_ANOMALY,
  SecurityEventTypes.NETWORK_CONNECTION,
  SecurityEventTypes.NETWORK_ANOMALY,
  SecurityEventTypes.NETWORK_FLOW,
  SecurityEventTypes.DNS_QUERY,
]);

const MAX_EVENTS_PER_BATCH = 500; // spec section 15/29 — bounded batch, not unbounded
const MAX_EVENT_JSON_BYTES = 4096; // spec section 29 — request/event size limits; a legitimate process/network observation is a few hundred bytes at most
const MAX_STRING_FIELD_LENGTH = 512;

// Fields the sensor is TRUSTED to report — pure observation, no
// interpretation (spec section 60: treat the sensor as another untrusted
// input source, same as any HTTP client). Anything not in this allowlist
// (severity, riskScore, decision, malicious, trusted, policy — spec
// section 33's explicit denylist) is silently dropped, never persisted,
// regardless of what the sensor sends — this is the enforcement point,
// not a formality.
const isValidString = (value, maxLen = MAX_STRING_FIELD_LENGTH) => typeof value === 'string' && value.length > 0 && value.length <= maxLen;
const isValidPort = (value) => Number.isInteger(value) && value >= 0 && value <= 65535;
const isValidPid = (value) => Number.isInteger(value) && value >= 0;

const sanitizeProcess = (process) => {
  if (!process || typeof process !== 'object') return null;
  const out = {};
  if (isValidString(process.name)) out.name = process.name;
  if (isValidPid(process.pid)) out.pid = process.pid;
  if (isValidPid(process.parentPid)) out.parentPid = process.parentPid;
  if (isValidString(process.parentName)) out.parentName = process.parentName;
  return Object.keys(out).length ? out : null;
};

const sanitizeNetwork = (network) => {
  if (!network || typeof network !== 'object') return null;
  const out = {};
  if (isValidString(network.destinationIp, 64)) out.destinationIp = network.destinationIp;
  if (isValidPort(network.destinationPort)) out.destinationPort = network.destinationPort;
  if (isValidString(network.protocol, 16)) out.protocol = network.protocol.toUpperCase();
  return Object.keys(out).length ? out : null;
};

// validator.isIP handles IPv4 AND IPv6 correctly (spec section 37: "do not
// implement simplistic regex-only validation if the project already has a
// robust utility available" — threatIntel/indicators.js already made this
// exact call for the same library).
const isValidIp = (value) => typeof value === 'string' && validator.isIP(value);

const isValidByteCount = (value) => Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

const PROTOCOLS = new Set(['TCP', 'UDP']);

// Phase 5 — one aggregated flow summary (spec section 5/30), NOT a raw
// packet. sourcePort is optional (a sensor may not always resolve the
// ephemeral local port); every other field mirrors the spec's own worked
// example exactly, with bytesSent/bytesReceived/durationMs all optional —
// "only include fields actually available... do not fabricate metadata."
const sanitizeFlow = (flow) => {
  if (!flow || typeof flow !== 'object') return null;
  if (!isValidIp(flow.destinationIp)) return null;
  if (!isValidPort(flow.destinationPort)) return null;
  if (!isValidString(flow.protocol, 16) || !PROTOCOLS.has(flow.protocol.toUpperCase())) return null;

  const out = {
    destinationIp: flow.destinationIp,
    destinationPort: flow.destinationPort,
    protocol: flow.protocol.toUpperCase(),
  };
  if (isValidIp(flow.sourceIp)) out.sourceIp = flow.sourceIp;
  if (isValidPort(flow.sourcePort)) out.sourcePort = flow.sourcePort;
  if (flow.direction === 'INBOUND' || flow.direction === 'OUTBOUND') out.direction = flow.direction;
  if (isValidByteCount(flow.bytesSent)) out.bytesSent = flow.bytesSent;
  if (isValidByteCount(flow.bytesReceived)) out.bytesReceived = flow.bytesReceived;
  if (Number.isInteger(flow.durationMs) && flow.durationMs >= 0) out.durationMs = flow.durationMs;
  if (isValidPid(flow.pid)) out.pid = flow.pid;
  if (isValidString(flow.processName)) out.processName = flow.processName;
  return out;
};

const DNS_QUERY_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR', 'OTHER']);

// DNS_QUERY (spec section 10) — domain + queryType only, exactly the spec's
// own worked example. No answer/response data at all in this pass (no
// resolved IPs, no TTLs) — see ebpf-sensor/README.md's scope note; the
// getaddrinfo() uprobe this event comes from only observes the QUERY side
// (the hostname argument), not the resolver's response.
const sanitizeDns = (dns) => {
  if (!dns || typeof dns !== 'object') return null;
  if (!isValidString(dns.domain, 253)) return null; // 253 — max valid DNS name length
  const out = { domain: dns.domain.toLowerCase() };
  if (isValidString(dns.queryType, 16) && DNS_QUERY_TYPES.has(dns.queryType.toUpperCase())) {
    out.queryType = dns.queryType.toUpperCase();
  }
  if (dns.nxdomain === true) out.nxdomain = true; // tri-state: only ever explicitly true; false/absent both mean "not known to be NXDOMAIN," never asserted
  if (isValidPid(dns.pid)) out.pid = dns.pid;
  if (isValidString(dns.processName)) out.processName = dns.processName;
  return out;
};

// Validates ONE event from a batch. Returns { ok, event, reason } — never
// throws, so one malformed event in a batch never aborts the rest (spec
// section 19/29: the backend must tolerate imperfect distributed delivery).
const validateSensorEvent = (raw) => {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_an_object' };

  const jsonSize = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (jsonSize > MAX_EVENT_JSON_BYTES) return { ok: false, reason: 'event_too_large' };

  if (!isValidString(raw.eventId, 128)) return { ok: false, reason: 'missing_event_id' };
  if (!SENSOR_ALLOWED_TYPES.has(raw.type)) return { ok: false, reason: 'unsupported_type' };
  if (!raw.timestamp || Number.isNaN(new Date(raw.timestamp).getTime())) return { ok: false, reason: 'invalid_timestamp' };

  const process = sanitizeProcess(raw.process);
  const network = sanitizeNetwork(raw.network);
  const flow = sanitizeFlow(raw.flow);
  const dns = sanitizeDns(raw.dns);

  // A PROCESS_* event with no process data, or a NETWORK_* event with no
  // network data, carries nothing worth persisting — reject rather than
  // silently store an empty observation. Same reasoning for Phase 5's
  // NETWORK_FLOW/DNS_QUERY: without the one field that makes them worth
  // anything (flow/dns respectively), they're empty telemetry.
  if ((raw.type === SecurityEventTypes.PROCESS_EXEC || raw.type === SecurityEventTypes.PROCESS_EXIT || raw.type === SecurityEventTypes.PROCESS_ANOMALY) && !process) {
    return { ok: false, reason: 'missing_process_data' };
  }
  if ((raw.type === SecurityEventTypes.NETWORK_CONNECTION || raw.type === SecurityEventTypes.NETWORK_ANOMALY) && !network) {
    return { ok: false, reason: 'missing_network_data' };
  }
  if (raw.type === SecurityEventTypes.NETWORK_FLOW && !flow) {
    return { ok: false, reason: 'missing_flow_data' };
  }
  if (raw.type === SecurityEventTypes.DNS_QUERY && !dns) {
    return { ok: false, reason: 'missing_dns_data' };
  }

  return {
    ok: true,
    event: {
      // sensorEventId (the sensor's own eventId) is kept SEPARATE from
      // this backend's own eventId (SecurityEventService.record() always
      // mints its own — see securityEventIngestion.js) — the sensor's id
      // is what dedup/idempotency keys on (spec section 19), the backend's
      // is the public-safe cross-reference id every other SecurityEvent
      // already uses.
      sensorEventId: raw.eventId,
      type: raw.type,
      sensorTimestamp: new Date(raw.timestamp),
      process,
      network,
      flow,
      dns,
      sensorVersion: isValidString(raw.sensorVersion, 32) ? raw.sensorVersion : null,
      eventSchemaVersion: Number.isInteger(raw.eventSchemaVersion) ? raw.eventSchemaVersion : null,
    },
  };
};

module.exports = {
  validateSensorEvent, SENSOR_ALLOWED_TYPES, MAX_EVENTS_PER_BATCH, MAX_EVENT_JSON_BYTES,
};

// SANITIZE_EXPORTS: exposed for network-intel-specific unit tests
// (sanitizeFlow/sanitizeDns's own edge cases) without re-deriving them
// through the full validateSensorEvent envelope every time.
module.exports.sanitizeFlow = sanitizeFlow;
module.exports.sanitizeDns = sanitizeDns;
