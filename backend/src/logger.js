const pino = require('pino');

// Pretty-printed in dev (readable), raw JSON in prod (ingestible by any log
// aggregator without a separate parser). request-id/correlation is handled
// by pino-http (see init.js's app.use(pinoHttp(...)) — req.id/req.log),
// not here — this is just the base logger.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});

module.exports = logger;
