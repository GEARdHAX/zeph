const SecurityEventService = require('../../services/securityEventService');
const { validateSensorEvent, MAX_EVENTS_PER_BATCH } = require('../../services/ebpf/sensorEventValidation');
const { claimEventOnce } = require('../../services/ebpf/sensorEventDedup');
const networkRules = require('../../services/networkIntel/networkRules');
const logger = require('../../logger');

// Shared batch ingestion endpoint for BOTH the Phase 4 eBPF sensor and the
// Phase 5 network sensor (spec section 34: "reuse the Phase 4 sensor
// authentication architecture... do not create a second sensor credential
// system") — mounted behind sensorAuth + sensorRateLimit (see
// routes/index.js), NEVER passport.authenticate. req.sensor (not req.user)
// is the only identity this handler trusts, and it comes from sensorAuth's
// own Mongo lookup, never from the request body.
//
// Severity/risk are computed HERE, never trusted from the sensor (spec
// section 33/36) — every event this endpoint accepts gets a fixed, type-
// derived severity (a "we observed X" fact is never itself high-severity;
// what a future risk engine/rule does WITH that fact is where severity
// actually emerges — see the base spec's own section 26: "avoid hardcoding
// 'malicious'"). PROCESS_ANOMALY/NETWORK_ANOMALY get 'medium' (a sensor-
// side rule already flagged something as unusual — spec section 24-25),
// everything else stays 'low' (plain observation). NETWORK_FLOW/DNS_QUERY
// are themselves plain observations too ('low') — the anomaly VERDICTS
// they might produce (PORT_SCAN_ANOMALY etc.) come out of networkRules.js
// below as their OWN separate SecurityEvents, at their own severity.
const SEVERITY_BY_TYPE = {
  PROCESS_ANOMALY: 'medium',
  NETWORK_ANOMALY: 'medium',
};

// Which sourceSystem a given event type is attributed to — Phase 4's
// process/network-connect observations came from the eBPF sensor; Phase 5's
// flow/DNS observations come from the network-sensor module (same physical
// process in this codebase's implementation — see ebpf-sensor/README.md
// — but a logically distinct producer, so it gets its own sourceSystem
// value, consistent with how 'ebpf' vs 'app' vs 'threat_intelligence'
// already distinguish producers on every other SecurityEvent).
const NETWORK_SENSOR_TYPES = new Set(['NETWORK_FLOW', 'DNS_QUERY']);
const sourceSystemFor = (type) => (NETWORK_SENSOR_TYPES.has(type) ? 'network_sensor' : 'ebpf');

module.exports = async (req, res) => {
  // Body shape: { events: [...] } — the sensor sends a real JSON body
  // (application/json), same convention groups.test.js documents for
  // create-group.js's own array field (people): express-formidable parses
  // a JSON request body's arrays/objects natively, no manual JSON.parse
  // needed here.
  const batch = req.fields.events;

  if (!Array.isArray(batch) || batch.length === 0) {
    return res.status(400).json({ error: true, reason: 'events_array_required' });
  }
  if (batch.length > MAX_EVENTS_PER_BATCH) {
    return res.status(413).json({ error: true, reason: 'batch_too_large' });
  }

  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;

  // Sequential, not Promise.all — a batch of up to 500 events hitting
  // Mongo/Redis concurrently from ONE request is exactly the kind of
  // self-inflicted load spec section 57 warns about; sequential
  // processing bounds this endpoint's own resource footprint regardless
  // of batch size, at the cost of some latency this ingestion path (not
  // user-facing, not on any request-response critical path elsewhere in
  // the app) can afford.
  // eslint-disable-next-line no-restricted-syntax
  for (const raw of batch) {
    const validation = validateSensorEvent(raw);
    if (!validation.ok) {
      rejected += 1;
      // eslint-disable-next-line no-continue
      continue;
    }

    const { event } = validation;
    // eslint-disable-next-line no-await-in-loop
    const isNew = await claimEventOnce(req.sensor.sensorId, event.sensorEventId);
    if (!isNew) {
      duplicates += 1;
      // eslint-disable-next-line no-continue
      continue;
    }

    SecurityEventService.record({
      type: event.type,
      severity: SEVERITY_BY_TYPE[event.type] || 'low',
      source: {}, // no HTTP-request IP/userAgent here — securityEventContext(req) doesn't apply; the OBSERVED network destination (if any) lives in metadata.network/metadata.flow, not source, since source normally means "who sent this HTTP request," which for sensor telemetry is the sensor's own transport connection, not a meaningful security signal
      target: { resource: 'sensor', action: event.type.toLowerCase() },
      result: 'unknown', // an observation, not a success/failure outcome
      sourceSystem: sourceSystemFor(event.type),
      metadata: {
        sensorId: req.sensor.sensorId,
        hostId: req.sensor.hostId,
        sensorEventId: event.sensorEventId,
        sensorTimestamp: event.sensorTimestamp,
        // Server receipt timestamp is whatever SecurityEvent.timestamp
        // ends up being (default:Date.now, set at record()-call time) —
        // spec section 20's "record sensor timestamp AND server receipt
        // timestamp, do not blindly trust the sensor's clock" is satisfied
        // by keeping both: sensorTimestamp here, the document's own
        // top-level timestamp field as receipt time.
        process: event.process,
        network: event.network,
        flow: event.flow,
        dns: event.dns,
        sensorVersion: event.sensorVersion,
        eventSchemaVersion: event.eventSchemaVersion,
      },
    });
    accepted += 1;

    // Phase 5 rule evaluation — fire-and-forget (never awaited: a rules
    // hiccup or slow Redis round trip must not hold up this HTTP response
    // or block processing the rest of the batch, same posture
    // SecurityEventService.record() itself already takes). Only runs for
    // the two Phase 5 raw-observation types; every other type (Phase 4's
    // process/connect events) has no network-rules integration in this
    // pass — see the final report's scope note on process<->network
    // correlation being deferred.
    if (event.type === 'NETWORK_FLOW' && event.flow) {
      networkRules.evaluateFlow({
        sensorId: req.sensor.sensorId, hostId: req.sensor.hostId, flow: event.flow,
      }).catch((err) => logger.warn({ err, sensorId: req.sensor.sensorId }, 'network_rules_flow_evaluation_failed'));
    } else if (event.type === 'DNS_QUERY' && event.dns) {
      networkRules.evaluateDnsQuery({
        sensorId: req.sensor.sensorId, hostId: req.sensor.hostId, dns: event.dns,
      }).catch((err) => logger.warn({ err, sensorId: req.sensor.sensorId }, 'network_rules_dns_evaluation_failed'));
    }
  }

  logger.info({
    sensorId: req.sensor.sensorId, batchSize: batch.length, accepted, duplicates, rejected,
  }, 'ebpf_sensor_batch_ingested');

  res.status(200).json({
    status: 'success', accepted, duplicates, rejected,
  });
};
