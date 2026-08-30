require('dotenv').config();
const info = require('./version.json');

if (!process.env.AUTH_SECRET) {
  console.error(
    'FATAL: AUTH_SECRET environment variable is not set. Refusing to start with an insecure default JWT secret.',
  );
  process.exit(1);
}

module.exports = {
  appVersion: info.version,
  appBuild: info.build,
  port: process.env.PORT || 4000,
  secret: process.env.AUTH_SECRET,
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:5173'],
  aiProvider: process.env.AI_PROVIDER || 'none',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:1b',
  // Threat Intelligence (Phase 3) — AbuseIPDB IP reputation, disabled
  // (safely no-op — see services/threatIntel/provider.js) unless BOTH the
  // flag and a real key are set, same "enabled + key both required" gate
  // security/init.js's own provider-selection convention doesn't have but
  // arguably should — kept deliberately conservative here since an
  // enabled-but-keyless config would otherwise silently 401 on every call.
  abuseIpDbEnabled: process.env.ABUSEIPDB_ENABLED === 'true',
  abuseIpDbApiKey: process.env.ABUSEIPDB_API_KEY || null,
  abuseIpDbBaseUrl: process.env.ABUSEIPDB_BASE_URL || 'https://api.abuseipdb.com',
  abuseIpDbTimeoutMs: Number(process.env.ABUSEIPDB_TIMEOUT_MS) || 5000,
  // ZEPH's own OPERATIONAL budget, not AbuseIPDB's account-wide daily quota
  // (currently 1000/day on the Standard free tier) — deliberately defaults
  // BELOW that so normal account/dashboard usage of the same key never
  // collides with it. See threatIntel/quota.js.
  abuseIpDbDailyBudget: Number(process.env.ABUSEIPDB_DAILY_BUDGET) || 800,
  threatIntelCacheTtlSeconds: Number(process.env.THREAT_INTEL_CACHE_TTL_SECONDS) || 6 * 60 * 60, // 6 hours
  // Phase 5 — Network Intelligence (spec section 49). The backend never
  // needs to know a sensor is "network" vs "ebpf" flavored to accept its
  // events (same ingestion endpoint/credential — see routes/index.js) — all
  // of these govern the backend-SIDE detection engine
  // (services/networkIntel/), which is what spec section 36 requires: the
  // backend computes anomaly verdicts, never trusts a sensor's own.
  networkSensorEnabled: process.env.NETWORK_SENSOR_ENABLED !== 'false', // detection itself is cheap Redis counter work; "enabled" gates whether NETWORK_* events are even accepted/processed, not a paid resource like AbuseIPDB
  networkFlowWindowMs: Number(process.env.NETWORK_FLOW_WINDOW_MS) || 60 * 1000, // spec section 27 — the sliding window port-scan/host-scan/beacon detection aggregates over
  networkMaxEventsPerBatch: Number(process.env.NETWORK_MAX_EVENTS_PER_BATCH) || 500, // matches Phase 4's MAX_EVENTS_PER_BATCH default — same ingestion endpoint, same bound
  networkMaxBufferSize: Number(process.env.NETWORK_MAX_BUFFER_SIZE) || 5000, // sensor-side config, documented here for the same reason Phase 4's ZEPH_MAX_BUFFER_SIZE is — the backend doesn't enforce this, the sensor process reads it directly
  networkEventRateLimit: Number(process.env.NETWORK_EVENT_RATE_LIMIT) || 200, // sensor-side self-throttle, same role as Phase 4's ZEPH_EVENT_RATE_LIMIT
  networkDnsAnalysisEnabled: process.env.NETWORK_DNS_ANALYSIS_ENABLED !== 'false',
  networkTlsMetadataEnabled: process.env.NETWORK_TLS_METADATA_ENABLED === 'true', // OFF by default AND not implemented this phase — see network-sensor/README.md's scope note; the flag exists now so a future phase adding it doesn't need a new config key
  networkBaselineEnabled: process.env.NETWORK_BASELINE_ENABLED !== 'false',
  // Comma-separated destinationIp or destinationIp:port entries (spec
  // section 41) — MongoDB/Redis/Cloudflare/Brevo/R2/etc, whatever this
  // deployment's own infra actually is. Deliberately NOT hardcoded (spec:
  // "do not hardcode assumptions if the environment varies") — empty by
  // default, meaning every destination looks "new" until an operator
  // configures this.
  networkBaselineTrusted: process.env.NETWORK_BASELINE_TRUSTED || '',
  networkScanThreshold: Number(process.env.NETWORK_SCAN_THRESHOLD) || 15, // distinct ports/hosts within networkFlowWindowMs before PORT_SCAN_ANOMALY/HOST_SCAN_ANOMALY fires
  networkBeaconThreshold: Number(process.env.NETWORK_BEACON_THRESHOLD) || 5, // consecutive same-interval connections to the same destination before POSSIBLE_BEACONING fires
  networkExfilThresholdBytes: Number(process.env.NETWORK_EXFIL_THRESHOLD) || 50 * 1024 * 1024, // 50MB — a single outbound flow above this to a non-baseline destination is POSSIBLE_DATA_EXFILTRATION-eligible
  // "Delete for everyone" window — how long after sending a message its
  // author can still delete it for every participant, not just themselves.
  // 1 hour by default: generous enough for normal "wrong chat/typo" use,
  // short enough to defend as "you can't rewrite history from days ago."
  messageDeletionWindowMs: Number(process.env.MESSAGE_DELETION_WINDOW_MS) || 60 * 60 * 1000,
  // Private Vault: how long a vault-unlock (PIN or passkey) stays valid
  // before the user must re-authenticate to reach hidden conversations.
  vaultTokenTtl: process.env.VAULT_TOKEN_TTL || '10m',
  // WebAuthn's rpID must be a bare hostname (no scheme/port) and must match
  // the browser's origin hostname exactly. Derived from the first configured
  // CORS origin so there's no separate hostname to keep in sync by hand;
  // override explicitly via VAULT_RP_ID if the deploy topology ever needs a
  // different value than the primary frontend origin.
  vaultRpId: process.env.VAULT_RP_ID || (() => {
    try {
      const corsOrigin = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')[0].trim()
        : 'http://localhost:5173';
      return new URL(corsOrigin).hostname;
    } catch (e) {
      return 'localhost';
    }
  })(),
  vaultRpName: 'zeph.',
  // Socket.IO Redis adapter (cross-process group room delivery) and the
  // group-deletion cleanup queue — both best-effort. Unset/unreachable
  // means single-process mode, never a boot crash. See DECISIONS.md D-035.
  redisUrl: process.env.REDIS_URL || null,
  mongo: {
    uri: process.env.MONGO_URI,
    srv: (process.env.MONGO_SRV || '').toString() === 'true',
    username: process.env.MONGO_USERNAME,
    password: process.env.MONGO_PASSWORD,
    authenticationDatabase: process.env.MONGO_AUTHENTICATION_DATABASE,
    hostname: process.env.MONGO_HOSTNAME,
    port: process.env.MONGO_PORT,
    database: process.env.MONGO_DATABASE_NAME || 'chitcx',
  },
  dataFolder: './data',
  rootUser: {
    username: process.env.ROOT_USER_USERNAME,
    email: process.env.ROOT_USER_EMAIL,
    password: process.env.ROOT_USER_PASSWORD,
    firstName: process.env.ROOT_USER_FIRST_NAME,
    lastName: process.env.ROOT_USER_LAST_NAME,
  },
  ipAddress: {
    ip: process.env.MAPPED_IP === 'true' ? '0.0.0.0' : process.env.PUBLIC_IP_ADDRESS,
    announcedIp: process.env.MAPPED_IP === 'true' ? process.env.PUBLIC_IP_ADDRESS : null,
  },

  nodemailerEnabled: process.env.MAILER_ENABLED === 'true',
  nodemailer: {
    from: process.env.MAILER_FROM || 'admin@example.com',
  },
  nodemailerTransport: {
    service: process.env.MAILER_SERVICE || undefined, // example: hotmail (leave blank if using own smtp below)
    host: process.env.MAILER_HOST || undefined, // example: smtp.yourdomain.tld (leave blank if using service above)
    port: process.env.MAILER_PORT ? Number(process.env.MAILER_PORT) : undefined,
    secure: process.env.MAILER_SECURE === 'true',
    auth: {
      user: process.env.MAILER_USERNAME,
      pass: process.env.MAILER_PASSWORD,
    },
  },

  // hardcoded
  retryAfter: 10000,
  sizes: [256, 512, 1024, 2048],
  mediaCodecs: [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: { 'x-google-start-bitrate': 1000 },
    },
  ],
  rtcMinPort: 10000,
  rtcMaxPort: 12000,
  mediasoupLogLevel: 'warn',
};
