const SecurityEvent = require('../../models/SecurityEvent');

// Turns raw SecurityEvent documents into the compact, bounded feature
// vector the AI actually receives (spec sections 5/7/9) — never raw event
// objects, never unbounded history. Two independent scopes, queried
// separately, matching the same honest attribution boundary riskEngine.js
// already draws: userId-scoped signals (genuinely this user's own
// behavior) vs sensorId/hostId-scoped signals (host/process-level,
// Phase 4/5's own telemetry). A caller building a "user login pattern"
// context passes userId; a caller building a "host X activity" context
// passes sensorId/hostId. Never both conflated into one vector claiming a
// correlation this data doesn't actually support.
const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // spec section 8's "5 minutes" — the middle of the suggested 1m/5m/15m/1h range, matches riskEngine.js's own LOOKBACK_MS order of magnitude

// Authentication/session feature vector — userId-scoped, reuses the exact
// SAME aggregate shape riskEngine.js's computeRiskFactors already runs
// (actor.userId + timestamp, one $group pass) so this stays consistent
// with the deterministic risk engine's own notion of "this user's recent
// behavior," not a second, subtly different counting method.
const extractAuthFeatures = async ({ userId, windowMs = DEFAULT_WINDOW_MS, newDevice = false, sessionAgeMs = null }) => {
  if (!userId) return null;
  const since = new Date(Date.now() - windowMs);

  const counts = await SecurityEvent.aggregate([
    { $match: { 'actor.userId': userId, timestamp: { $gte: since } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);
  const countByType = Object.fromEntries(counts.map((c) => [c._id, c.count]));

  return {
    timeWindow: windowMsToLabel(windowMs),
    scope: 'user',
    userId,
    failedLoginCount: countByType.LOGIN_FAILED || 0,
    rateLimitCount: countByType.RATE_LIMIT_TRIGGERED || 0,
    permissionDeniedCount: (countByType.PERMISSION_DENIED || 0) + (countByType.UNAUTHORIZED_ACCESS || 0),
    newDevice: !!newDevice,
    sessionAgeMs: Number.isFinite(sessionAgeMs) ? sessionAgeMs : null,
  };
};

// Host/network feature vector — sensorId+hostId-scoped, drawing on the
// SAME sourceSystem:'ebpf'/'network_sensor' events Phase 4/5 already
// produce. Deliberately reads only counts/flags per spec section 5's own
// worked example ("processSignals": ["unexpected_child_process"] etc.) —
// never a raw process name, raw destination IP, or raw domain string
// (those are stripped by sanitizer.js before anything reaches a prompt;
// this function's OWN job is aggregation, sanitizer.js's job is redaction
// — kept as two separate, individually testable steps).
const extractHostFeatures = async ({ sensorId, hostId, windowMs = DEFAULT_WINDOW_MS }) => {
  if (!sensorId) return null;
  const since = new Date(Date.now() - windowMs);

  const counts = await SecurityEvent.aggregate([
    { $match: { 'metadata.sensorId': sensorId, timestamp: { $gte: since } } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);
  const countByType = Object.fromEntries(counts.map((c) => [c._id, c.count]));

  // Distinct destination count needs the actual field, not just a type
  // count — one more bounded aggregate, same window/match.
  const [{ uniqueDestinations = [] } = {}] = await SecurityEvent.aggregate([
    {
      $match: {
        'metadata.sensorId': sensorId, timestamp: { $gte: since }, 'metadata.destinationIp': { $exists: true, $ne: null },
      },
    },
    { $group: { _id: null, uniqueDestinations: { $addToSet: '$metadata.destinationIp' } } },
  ]);

  return {
    timeWindow: windowMsToLabel(windowMs),
    scope: 'host',
    sensorId,
    hostId: hostId || null,
    processAnomalyCount: countByType.PROCESS_ANOMALY || 0,
    networkAnomalyCount: countByType.NETWORK_ANOMALY || 0,
    portScanCount: countByType.PORT_SCAN_ANOMALY || 0,
    hostScanCount: countByType.HOST_SCAN_ANOMALY || 0,
    beaconingCount: countByType.POSSIBLE_BEACONING || 0,
    exfiltrationCount: countByType.POSSIBLE_DATA_EXFILTRATION || 0,
    dnsAnomalyCount: countByType.DNS_ANOMALY || 0,
    maliciousIpCount: countByType.THREAT_INTEL_NETWORK_MATCH || 0,
    uniqueDestinationCount: uniqueDestinations.length,
    connectionCount: countByType.NETWORK_FLOW || 0,
    dnsQueryCount: countByType.DNS_QUERY || 0,
  };
};

const windowMsToLabel = (ms) => {
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
  return `${Math.round(ms / (60 * 1000))}m`;
};

module.exports = { extractAuthFeatures, extractHostFeatures, DEFAULT_WINDOW_MS };
