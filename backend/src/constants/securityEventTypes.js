// Central event taxonomy for SecurityEventService — every `type` passed to
// SecurityEventService.record() must be one of these, or the service logs a
// warning and refuses to persist a malformed/unknown event type. Add new
// types here first, then wire the producer — never invent a type inline at
// a call site.
const SecurityEventTypes = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',

  LOGOUT: 'LOGOUT',

  TOKEN_REFRESH: 'TOKEN_REFRESH',
  TOKEN_REVOKED: 'TOKEN_REVOKED',

  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_SUCCESS: 'PASSWORD_RESET_SUCCESS',
  PASSWORD_RESET_FAILED: 'PASSWORD_RESET_FAILED',

  MFA_FAILED: 'MFA_FAILED',

  RATE_LIMIT_TRIGGERED: 'RATE_LIMIT_TRIGGERED',

  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',

  FILE_UPLOAD: 'FILE_UPLOAD',
  FILE_UPLOAD_REJECTED: 'FILE_UPLOAD_REJECTED',

  GROUP_JOIN: 'GROUP_JOIN',
  GROUP_LEAVE: 'GROUP_LEAVE',

  MESSAGE_SENT: 'MESSAGE_SENT',

  CALL_STARTED: 'CALL_STARTED',
  CALL_ENDED: 'CALL_ENDED',

  ADMIN_ACTION: 'ADMIN_ACTION',

  // Phase 2 — Zero Trust (spec section 24). One event per policy-engine
  // decision (see lib/zeroTrust.js), plus session/device state changes the
  // risk engine's own logic can now derive (sessionContext.js).
  ZERO_TRUST_ALLOW: 'ZERO_TRUST_ALLOW',
  ZERO_TRUST_STEP_UP: 'ZERO_TRUST_STEP_UP',
  ZERO_TRUST_DENY: 'ZERO_TRUST_DENY',
  SESSION_SUSPICIOUS: 'SESSION_SUSPICIOUS',
  SESSION_REVOKED: 'SESSION_REVOKED',
  DEVICE_REGISTERED: 'DEVICE_REGISTERED',
  DEVICE_MARKED_SUSPICIOUS: 'DEVICE_MARKED_SUSPICIOUS',

  // Phase 3 — Threat Intelligence (spec section 15/37). Only the three this
  // phase actually has a real trigger for — THREAT_INTEL_PROVIDER_UNAVAILABLE
  // and THREAT_INTEL_CIRCUIT_OPEN are NOT wired to a producer (the circuit
  // breaker's own state transitions are already Pino-logged in
  // circuitBreaker.js; a second SecurityEvent for the same fact would be
  // exactly the "event for every cache hit" log-spam this spec section
  // itself warns against). See threatIntelService.js for producers.
  THREAT_INTEL_MATCH: 'THREAT_INTEL_MATCH',
  THREAT_INTEL_LOOKUP_FAILED: 'THREAT_INTEL_LOOKUP_FAILED',
  THREAT_INTEL_RATE_LIMITED: 'THREAT_INTEL_RATE_LIMITED',

  // Phase 4 — eBPF Runtime Security (spec sections 6/44). sourceSystem:
  // 'ebpf' on every one of these (see securityEventService.js's own
  // sourceSystem field) — the type alone doesn't imply the source, a
  // future non-eBPF sensor could theoretically reuse PROCESS_EXEC etc.
  // Only the events this phase actually has a real producer for (the
  // sensor's own event-normalization layer, ebpf-sensor/src/events.js) —
  // no FILE_ACCESS event type exists because Phase 4's sensor does not
  // implement file monitoring (see the final report's honest scope note).
  PROCESS_EXEC: 'PROCESS_EXEC',
  PROCESS_EXIT: 'PROCESS_EXIT',
  PROCESS_ANOMALY: 'PROCESS_ANOMALY',
  NETWORK_CONNECTION: 'NETWORK_CONNECTION',
  NETWORK_ANOMALY: 'NETWORK_ANOMALY',

  // Phase 5 — Network Intelligence (spec section 42). sourceSystem:
  // 'network_sensor' on every one of these (see ebpf-sensor/src/, the
  // Phase 4 ebpf-sensor process extended with a network-flow module — same
  // process, same credential, same ingestion endpoint, per the spec's own
  // "reuse the Phase 4 sensor architecture" instruction). NETWORK_FLOW is
  // the aggregated summary event (spec section 30: one event per flow, not
  // per packet); NETWORK_CONNECTION above stays Phase 4's single-packet-
  // moment "a connect() happened" observation — Phase 5 does not replace it,
  // it adds the aggregated counterpart. No HTTP_METADATA event type exists
  // (spec section 16's own preference: "prefer not to inspect HTTP payloads
  // at all" — this pass implements none of it, see the final report).
  NETWORK_FLOW: 'NETWORK_FLOW',
  DNS_QUERY: 'DNS_QUERY',
  DNS_ANOMALY: 'DNS_ANOMALY',
  PORT_SCAN_ANOMALY: 'PORT_SCAN_ANOMALY',
  HOST_SCAN_ANOMALY: 'HOST_SCAN_ANOMALY',
  POSSIBLE_BEACONING: 'POSSIBLE_BEACONING',
  POSSIBLE_DATA_EXFILTRATION: 'POSSIBLE_DATA_EXFILTRATION',
  THREAT_INTEL_NETWORK_MATCH: 'THREAT_INTEL_NETWORK_MATCH',

  // Phase 6 — AI Security Risk Engine (spec section 44). sourceSystem:
  // 'security_ai' (see securityAiService.js). AI_SECURITY_ANALYSIS is the
  // routine "an analysis ran" record (any mode, any verdict);
  // AI_ANOMALY_DETECTED is a SEPARATE, additional event only when the
  // structured result actually says anomalous:true — so an admin filtering
  // for AI_ANOMALY_DETECTED sees only the events worth their attention,
  // without wading through routine "checked, nothing found" analyses (spec
  // section 44: "do not emit events for every internal cache hit" — same
  // reasoning extended to "every analysis," not just cache hits).
  AI_SECURITY_ANALYSIS: 'AI_SECURITY_ANALYSIS',
  AI_ANOMALY_DETECTED: 'AI_ANOMALY_DETECTED',
  AI_ANALYSIS_FAILED: 'AI_ANALYSIS_FAILED',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_CIRCUIT_OPEN: 'AI_CIRCUIT_OPEN',
});

const SecurityEventSeverities = Object.freeze(['low', 'medium', 'high', 'critical']);
const SecurityEventResults = Object.freeze(['success', 'failure', 'blocked', 'unknown']);

module.exports = { SecurityEventTypes, SecurityEventSeverities, SecurityEventResults };
