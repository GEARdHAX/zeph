require('dotenv').config();

// Mirrors backend/.env.example's "eBPF Runtime Security Sensor" section —
// this process reads its OWN environment, entirely separate from the ZEPH
// backend's. No shared config file, no shared process, no shared secrets
// beyond the one credential this sensor was issued.
const config = {
  apiUrl: process.env.ZEPH_SECURITY_API_URL || '',
  sensorId: process.env.ZEPH_SENSOR_ID || '',
  hostId: process.env.ZEPH_HOST_ID || '',
  credential: process.env.ZEPH_SENSOR_CREDENTIAL || '',
  batchSize: parseInt(process.env.ZEPH_BATCH_SIZE, 10) || 50,
  batchIntervalMs: parseInt(process.env.ZEPH_BATCH_INTERVAL_MS, 10) || 5000,
  maxBufferSize: parseInt(process.env.ZEPH_MAX_BUFFER_SIZE, 10) || 5000,
  eventRateLimit: parseInt(process.env.ZEPH_EVENT_RATE_LIMIT, 10) || 200,
  logLevel: process.env.ZEPH_LOG_LEVEL || 'info',
  bpftracePath: process.env.ZEPH_BPFTRACE_PATH || 'bpftrace',
  // Phase 5 — DNS query observation (scripts/dns.bt's getaddrinfo()
  // uprobe). Mirrors backend/.env.example's NETWORK_DNS_ANALYSIS_ENABLED
  // name/intent but is read from THIS process's own environment — the
  // backend flag gates whether IT processes DNS_QUERY events server-side;
  // this one gates whether the sensor even RUNS the dns.bt uprobe at all
  // (skipping it entirely is the honest choice on a host where the
  // configured libc path doesn't resolve — see index.js's own handling).
  dnsAnalysisEnabled: process.env.NETWORK_DNS_ANALYSIS_ENABLED !== 'false',
  // NOT currently wired into scripts/dns.bt — bpftrace resolves a uprobe's
  // target path at PARSE time, so it cannot be substituted from this env
  // var the way network.bt's numeric fields are decoded in Node instead.
  // Present here to document the intent/override mechanism (edit dns.bt's
  // one hardcoded uprobe line directly) rather than silently claiming
  // runtime configurability that doesn't exist — see dns.bt's own comment
  // and ebpf-sensor/README.md.
  libcPath: process.env.NETWORK_SENSOR_LIBC_PATH || '/lib/x86_64-linux-gnu/libc.so.6',
};

const validateConfig = (cfg) => {
  const missing = ['apiUrl', 'sensorId', 'hostId', 'credential'].filter((key) => !cfg[key]);
  if (missing.length) {
    throw new Error(`ebpf-sensor: missing required config: ${missing.map((k) => `ZEPH_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`).join(', ')}`);
  }
};

module.exports = { config, validateConfig };
