const { isPrivileged } = require('../../authorization/policy');
const SensorCredential = require('../../models/SensorCredential');
const SecurityEvent = require('../../models/SecurityEvent');

// Admin sensor status view (spec sections 38-39/46) — deliberately minimal:
// sensor/host/status/version/last-heartbeat/events/dropped, NOT a full
// command center. "status" is derived here, not stored: a sensor counts as
// online if it successfully posted a batch within the last 5 minutes
// (lastUsedAt, updated by sensorAuth.js on every authenticated request) —
// no separate heartbeat mechanism exists yet (see ebpf-sensor/README.md's
// own note on this being a natural Phase 5 addition).
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(404).json({ error: true });

  const sensors = await SensorCredential.find({ revokedAt: null }).lean();

  const since = new Date(Date.now() - RECENT_WINDOW_MS);
  // One aggregate for counts, one for "most recent event per sensor" (its
  // metadata.sensorVersion is the only place the sensor's version is ever
  // recorded — see routes/security/sensor-events.js — there is no separate
  // dropped-events counter server-side, since a dropped event is by
  // definition one the backend never received; "dropped" in the sensor's
  // own sense only exists in its local logs, see ebpf-sensor/src/index.js's
  // heartbeat log line. Not fabricating a number here for it.)
  const [counts, latestPerSensor] = await Promise.all([
    SecurityEvent.aggregate([
      { $match: { sourceSystem: 'ebpf', timestamp: { $gte: since } } },
      { $group: { _id: '$metadata.sensorId', count: { $sum: 1 } } },
    ]),
    SecurityEvent.aggregate([
      { $match: { sourceSystem: 'ebpf' } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$metadata.sensorId', sensorVersion: { $first: '$metadata.sensorVersion' } } },
    ]),
  ]);
  const eventCountBySensor = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  const versionBySensor = Object.fromEntries(latestPerSensor.map((c) => [c._id, c.sensorVersion]));

  const now = Date.now();
  const result = sensors.map((s) => {
    const lastHeartbeat = s.lastUsedAt || null;
    const online = lastHeartbeat && (now - new Date(lastHeartbeat).getTime()) < ONLINE_THRESHOLD_MS;
    return {
      sensorId: s.sensorId,
      hostId: s.hostId,
      status: online ? 'online' : 'offline',
      version: versionBySensor[s.sensorId] || null,
      lastHeartbeat,
      eventsLast24h: eventCountBySensor[s.sensorId] || 0,
      registeredAt: s.createdAt,
    };
  });

  res.status(200).json({ sensors: result });
};
