const SecurityEvent = require('../../models/SecurityEvent');
const { isPrivileged } = require('../../authorization/policy');

// Admin network-intelligence summary (spec section 47-48) — deliberately
// NOT a raw event listing (GET /api/security/events?type=... already
// covers that — every Phase 5 event type is a real SecurityEventTypes
// entry, so the existing Phase 1 filterable viewer works unmodified; a
// second listing endpoint here would be pure duplication). This is the one
// thing that viewer can't do on its own: aggregate counts and a "top
// suspicious destinations" rollup, matching the spec's own minimal-UI list
// ("Recent Network Alerts, Top Suspicious Destinations, Threat Intel
// Matches, Network Anomalies, Sensor Status" — sensor status is already
// covered by GET /api/security/sensor/status from Phase 4).
const ALERT_TYPES = ['PORT_SCAN_ANOMALY', 'HOST_SCAN_ANOMALY', 'POSSIBLE_BEACONING', 'POSSIBLE_DATA_EXFILTRATION', 'THREAT_INTEL_NETWORK_MATCH', 'DNS_ANOMALY'];
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_ALERTS_LIMIT = 30;
const TOP_DESTINATIONS_LIMIT = 10;

module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const since = new Date(Date.now() - RECENT_WINDOW_MS);

  const [recentAlerts, countsByType, topDestinations] = await Promise.all([
    SecurityEvent.find({ type: { $in: ALERT_TYPES }, timestamp: { $gte: since } })
      .sort({ timestamp: -1 })
      .limit(RECENT_ALERTS_LIMIT)
      .select('-metadata.process') // keep the destination/reason fields, drop the bulkier nested process object for a lighter list payload
      .lean(),
    SecurityEvent.aggregate([
      { $match: { type: { $in: ALERT_TYPES }, timestamp: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    // "Top suspicious destinations" — destinations that appear on an ALERT
    // (not every plain NETWORK_FLOW observation, which would just surface
    // the most-visited ordinary service). Reads whichever of
    // metadata.destinationIp (rules) exists on these alert types.
    SecurityEvent.aggregate([
      {
        $match: {
          type: { $in: ALERT_TYPES }, timestamp: { $gte: since }, 'metadata.destinationIp': { $exists: true, $ne: null },
        },
      },
      { $group: { _id: '$metadata.destinationIp', count: { $sum: 1 }, lastSeen: { $max: '$timestamp' } } },
      { $sort: { count: -1 } },
      { $limit: TOP_DESTINATIONS_LIMIT },
    ]),
  ]);

  res.status(200).json({
    windowMs: RECENT_WINDOW_MS,
    recentAlerts,
    countsByType: Object.fromEntries(countsByType.map((c) => [c._id, c.count])),
    topSuspiciousDestinations: topDestinations.map((d) => ({ destinationIp: d._id, count: d.count, lastSeen: d.lastSeen })),
  });
};
