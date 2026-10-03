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
    // ioredis attaches the full command it sent to any ReplyError, so a
    // Redis-level failure (e.g. a quota/connection error) logs
    // `err.command.args` verbatim — for BullMQ's own Lua scripts (moveStalled-
    // JobsToWait, addDelayedJob, etc.) that's the ENTIRE script source plus
    // every queue key name, multiple KB per line, repeated on every retry.
    // Never actionable for debugging (the message/stack already identifies
    // the failure), so it's dropped rather than kept truncated.
    'err.command.args',
  ],
  censor: '[REDACTED]',
};

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  redact: REDACT_CONFIG,
});

// Some failure sources (BullMQ's blocking-connection retry, holding steady
// at ~30ms while Redis stays down) call logger.warn() far faster than any
// human reads logs — the command-args redact above shrinks each line, but
// at that rate it's still thousands of near-identical lines per minute.
// throttledWarn collapses repeats of the same `key` to at most one per
// `windowMs`: still an immediate first log (never silent), then quiet until
// the window elapses, instead of continuing at retry speed.
const lastLoggedAt = new Map();
const throttledWarn = (key, windowMs, obj, msg) => {
  const now = Date.now();
  const last = lastLoggedAt.get(key);
  if (last && now - last < windowMs) return;
  lastLoggedAt.set(key, now);
  logger.warn(obj, msg);
};

module.exports = logger;
module.exports.REDACT_CONFIG = REDACT_CONFIG;
module.exports.throttledWarn = throttledWarn;
