// Final data-minimization gate (spec sections 6/39) before ANY context
// reaches promptBuilder.js. featureExtraction.js already only produces
// counts/flags, never raw strings — this is the defense-in-depth
// allowlist step for the one place free-text CAN legitimately appear
// (a bounded, pre-defined signal label like "unusual_destination", never
// an arbitrary string a caller invented), so a future caller extending the
// context object can't accidentally leak something unbounded (a raw
// domain, a raw process name, a message snippet) into a prompt just by
// adding a field to it.
const ALLOWED_SIGNAL_LABELS = new Set([
  'unexpected_child_process',
  'process_anomaly',
  'unusual_destination',
  'high_connection_rate',
  'port_scan',
  'host_scan',
  'possible_beaconing',
  'possible_exfiltration',
  'dns_anomaly',
  'malicious_ip',
  'repeated_failed_login',
  'new_device',
  'rate_limit_triggered',
  'permission_denied',
]);

const isSafeNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Strips a raw feature-vector-ish object down to only the fields/shapes
// this module explicitly recognizes. Anything not in this allowlist is
// silently dropped — the enforcement point, not a formality (same posture
// backend/src/services/ebpf/sensorEventValidation.js already takes toward
// untrusted sensor input).
const sanitizeContext = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};

  if (typeof raw.timeWindow === 'string' && raw.timeWindow.length <= 16) out.timeWindow = raw.timeWindow;
  if (raw.scope === 'user' || raw.scope === 'host') out.scope = raw.scope;

  // Counts — every numeric field featureExtraction.js can produce, and
  // nothing else. A field name not in this list (even a plausible-looking
  // one) is dropped, not passed through.
  const numericFields = [
    'failedLoginCount', 'rateLimitCount', 'permissionDeniedCount', 'sessionAgeMs',
    'processAnomalyCount', 'networkAnomalyCount', 'portScanCount', 'hostScanCount',
    'beaconingCount', 'exfiltrationCount', 'dnsAnomalyCount', 'maliciousIpCount',
    'uniqueDestinationCount', 'connectionCount', 'dnsQueryCount',
  ];
  numericFields.forEach((field) => {
    if (isSafeNumber(raw[field])) out[field] = raw[field];
  });

  if (typeof raw.newDevice === 'boolean') out.newDevice = raw.newDevice;

  // signals: only pre-defined labels, never free text — this is what
  // keeps a compromised/malicious process name or domain string (which
  // COULD otherwise end up as a "signal" if a caller was careless) from
  // ever reaching the prompt as anything other than a fixed enum value.
  if (Array.isArray(raw.signals)) {
    out.signals = raw.signals.filter((s) => typeof s === 'string' && ALLOWED_SIGNAL_LABELS.has(s)).slice(0, 20);
  }

  // threatSignals: bounded shape only — {type, confidence}, confidence
  // clamped, type restricted to what ThreatIntelService actually produces
  // (indicators.js's IndicatorTypes).
  if (Array.isArray(raw.threatSignals)) {
    out.threatSignals = raw.threatSignals
      .filter((t) => t && typeof t === 'object' && ['IP', 'DOMAIN', 'URL', 'HASH'].includes(t.type) && isSafeNumber(t.confidence))
      .map((t) => ({ type: t.type, confidence: Math.min(100, Math.max(0, Math.round(t.confidence))) }))
      .slice(0, 10);
  }

  return out;
};

module.exports = { sanitizeContext, ALLOWED_SIGNAL_LABELS };
