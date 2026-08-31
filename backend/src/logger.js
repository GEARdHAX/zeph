const pino = require('pino');

// Pretty-printed in dev (readable), raw JSON in prod (ingestible by any log
// aggregator without a separate parser). request-id/correlation is handled
// by pino-http (see index.js's app.use(pinoHttp(...)) — req.id/req.log,
// the ONE mount — init.js used to have a second, duplicate mount that
// silently overwrote req.id; removed in Phase 7), not here — this is just
// the base logger.
// Phase 9 audit finding, confirmed empirically (not just by reading
// pino-http's source): pino-http's DEFAULT request serializer copies
// `req.headers` verbatim into every access-log line — including
// Authorization. Since this app's sole auth credential is a Bearer JWT
// (no cookies), every request's log line previously contained that
// user's live session token in plaintext. A real captured log line during
// this audit showed `"authorization":"Bearer <token>"` on every request.
// redact applies globally to every logger.*() call in this process, not
// just pino-http's own req/res objects — covers any future accidental
// `logger.info({req})`-shaped call too, not only the one call site found
// during this audit. censor '[REDACTED]' rather than removing the key
// entirely so a log reader can still see the header WAS present, useful
// for debugging auth issues without exposing the credential itself.
// Exported (not inlined below) so test/logger-redaction.test.js can build
// a real pino instance with the EXACT same config this app actually
// ships — pino doesn't expose a constructed instance's own redact option
// back for introspection, so re-deriving/guessing it in a test would risk
// silently testing a different config than production actually runs.
const REDACT_CONFIG = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    '*.password',
    '*.currentPassword',
    '*.repeatPassword',
    '*.token',
    '*.code', // AuthCode's reset code
  ],
  censor: '[REDACTED]',
};

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  redact: REDACT_CONFIG,
});

module.exports = logger;
module.exports.REDACT_CONFIG = REDACT_CONFIG;
