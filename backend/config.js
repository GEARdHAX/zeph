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
