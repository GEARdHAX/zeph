// Small, deterministic, in-process rules (spec section 4/22-25 — NOT AI,
// NOT ML, NOT DPI — plain counters). Each rule inspects the normalized
// event stream and may emit an EXTRA anomaly event alongside the original
// observation — it never replaces or mutates the original event.
//
// State is process-lifetime, in-memory, unbounded-but-small (bounded by
// distinct pid/ip values actually seen — a real host has thousands, not
// millions, of these per rule's lookback window).
const EXEC_BURST_WINDOW_MS = 10 * 1000;
const EXEC_BURST_THRESHOLD = 20; // >20 process execs in 10s from one parent is unusual for anything but a build/test runner — a bare-metal/VPS security host running ZEPH's sensor is not expected to do that

const CONNECT_BURST_WINDOW_MS = 10 * 1000;
const CONNECT_BURST_THRESHOLD = 30; // >30 distinct outbound connections in 10s — port-scan/beaconing shape, not normal app traffic

class AnomalyRules {
  constructor() {
    this.execTimestampsByParent = new Map(); // parentPid -> number[]
    this.connectTimestamps = [];
  }

  // Returns an array of zero or more extra anomaly events derived from this
  // one normalized event.
  evaluate(event) {
    const anomalies = [];
    const now = Date.now();

    if (event.type === 'PROCESS_EXEC') {
      const key = event.process?.parentPid ?? 'unknown';
      const list = this.execTimestampsByParent.get(key) || [];
      list.push(now);
      const recent = list.filter((t) => now - t <= EXEC_BURST_WINDOW_MS);
      this.execTimestampsByParent.set(key, recent);
      if (recent.length > EXEC_BURST_THRESHOLD) {
        anomalies.push({
          type: 'PROCESS_ANOMALY',
          eventId: `${event.eventId}-anomaly`,
          timestamp: event.timestamp,
          sensorVersion: event.sensorVersion,
          eventSchemaVersion: event.eventSchemaVersion,
          process: event.process,
        });
        this.execTimestampsByParent.set(key, []); // reset — one anomaly per burst, not one per event over threshold
      }
    }

    if (event.type === 'NETWORK_CONNECTION') {
      this.connectTimestamps.push(now);
      this.connectTimestamps = this.connectTimestamps.filter((t) => now - t <= CONNECT_BURST_WINDOW_MS);
      if (this.connectTimestamps.length > CONNECT_BURST_THRESHOLD) {
        anomalies.push({
          type: 'NETWORK_ANOMALY',
          eventId: `${event.eventId}-anomaly`,
          timestamp: event.timestamp,
          sensorVersion: event.sensorVersion,
          eventSchemaVersion: event.eventSchemaVersion,
          network: event.network,
        });
        this.connectTimestamps = [];
      }
    }

    return anomalies;
  }
}

module.exports = { AnomalyRules, EXEC_BURST_THRESHOLD, CONNECT_BURST_THRESHOLD };
