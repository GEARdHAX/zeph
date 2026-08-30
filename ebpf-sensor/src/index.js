const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { config, validateConfig } = require('./config');
const BpftraceRunner = require('./bpftraceRunner');
const BoundedBuffer = require('./buffer');
const Uploader = require('./uploader');
const { normalizeRawEvent } = require('./events');
const { AnomalyRules } = require('./anomalyRules');

const log = (level, msg) => {
  const levels = ['error', 'warn', 'info', 'debug'];
  if (levels.indexOf(level) <= levels.indexOf(config.logLevel)) {
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](`[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`);
  }
};

// Capability check (spec's own "verify before running, do not fake it") —
// fail loudly and immediately on a host that cannot actually run this
// sensor, rather than silently doing nothing.
const checkCapabilities = () => {
  if (os.platform() !== 'linux') {
    throw new Error(`ebpf-sensor requires Linux; running on ${os.platform()}. This sensor cannot function on this host.`);
  }
  try {
    execSync(`${config.bpftracePath} --version`, { stdio: 'ignore' });
  } catch {
    throw new Error(`bpftrace not found or not runnable (looked for "${config.bpftracePath}"). Install bpftrace and/or set ZEPH_BPFTRACE_PATH.`);
  }
};

const main = () => {
  validateConfig(config);
  checkCapabilities();

  const buffer = new BoundedBuffer(config.maxBufferSize);
  const anomalyRules = new AnomalyRules();
  const uploader = new Uploader({
    apiUrl: config.apiUrl, sensorId: config.sensorId, credential: config.credential, logger: { error: (m) => log('error', m), warn: (m) => log('warn', m) },
  });

  // Sensor's own self-throttle (spec section 35's ZEPH_EVENT_RATE_LIMIT) —
  // independent of, and in addition to, the backend's sensorRateLimit. A
  // misbehaving/looping .bt script on THIS host shouldn't even attempt to
  // flood the network, let alone rely on the backend to reject it.
  let eventsThisSecond = 0;
  setInterval(() => { eventsThisSecond = 0; }, 1000).unref();

  const handleRawEvent = (raw) => {
    const event = normalizeRawEvent(raw);
    if (!event) return;

    if (eventsThisSecond >= config.eventRateLimit) return; // self-throttled — drop, don't buffer (a real flood shouldn't consume buffer space either)
    eventsThisSecond += 1;
    buffer.push(event);

    anomalyRules.evaluate(event).forEach((anomaly) => buffer.push(anomaly));
  };

  const handleRunnerError = (err) => log('warn', err.message);

  const runners = [
    new BpftraceRunner({
      scriptPath: path.join(__dirname, '..', 'scripts', 'process.bt'),
      bpftracePath: config.bpftracePath,
      onEvent: handleRawEvent,
      onError: handleRunnerError,
    }),
    new BpftraceRunner({
      scriptPath: path.join(__dirname, '..', 'scripts', 'network.bt'),
      bpftracePath: config.bpftracePath,
      onEvent: handleRawEvent,
      onError: handleRunnerError,
    }),
  ];

  // Phase 5 — DNS observation (scripts/dns.bt) is its own runner, gated
  // separately (config.dnsAnalysisEnabled) since it's a uprobe on a
  // specific libc build/path (see dns.bt's own comment) — more likely to
  // fail on an unusual host than the scheduler tracepoints/kprobes the
  // other two scripts use. A dns.bt failure (logged via handleRunnerError,
  // same as any other runner) never takes down process/network
  // observation — each runner is an independent subprocess.
  if (config.dnsAnalysisEnabled) {
    runners.push(new BpftraceRunner({
      scriptPath: path.join(__dirname, '..', 'scripts', 'dns.bt'),
      bpftracePath: config.bpftracePath,
      onEvent: handleRawEvent,
      onError: handleRunnerError,
    }));
  }

  runners.forEach((r) => r.start());

  // Batching loop (spec section 17) — takes up to batchSize events off the
  // buffer every batchIntervalMs and uploads them; failed batches are
  // requeued (bounded, drop-oldest — see buffer.js) rather than lost
  // outright on a transient network blip.
  const flush = async () => {
    if (buffer.size === 0) return;
    const batch = buffer.takeBatch(config.batchSize);
    const ok = await uploader.sendWithRetry(batch);
    if (!ok) buffer.requeue(batch);
  };
  const flushInterval = setInterval(() => { flush().catch((err) => log('error', `flush failed: ${err.message}`)); }, config.batchIntervalMs);

  // Heartbeat (spec sections 38-39) — reuses the same batch endpoint isn't
  // right (heartbeat isn't a security observation); instead it's just a log
  // line for now — the admin UI's "last heartbeat" reads it from the
  // backend's own lastUsedAt on SensorCredential (updated on every accepted
  // batch — see sensorAuth.js), which is a truthful, already-existing
  // signal. A dedicated heartbeat endpoint is a natural Phase 5 addition if
  // a sensor that receives NO observable activity for a long stretch (and
  // so never uploads) needs to be distinguished from a dead sensor.
  const heartbeatInterval = setInterval(() => {
    log('info', `heartbeat: buffered=${buffer.size} dropped=${buffer.droppedCount}`);
  }, 60000);

  const shutdown = () => {
    log('info', 'shutting down');
    runners.forEach((r) => r.stop());
    clearInterval(flushInterval);
    clearInterval(heartbeatInterval);
    flush().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log('info', `ebpf-sensor started (sensorId=${config.sensorId}, hostId=${config.hostId})`);
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`ebpf-sensor: fatal: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main, checkCapabilities };
