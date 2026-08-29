require('colors');
require('dotenv').config();

const logger = require('./src/logger');
const pinoHttp = require('pino-http');

logger.info('zeph server starting');

const express = require('express');
const compression = require('compression');
const app = express();
// Request-ID + structured access logging. skip() keeps the 5s health-check
// poll (Docker/load-balancer) out of the logs — it's not signal.
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/healthz' },
}));
// gzip/br response compression — meaningful payload savings on slow/metered mobile connections.
app.use(compression());
const http = require('http');
const io = require('socket.io');
const setupRedisAdapter = require('./src/setupRedisAdapter');
const { startGroupCleanupWorker } = require('./src/queues/groupCleanupWorker');
const store = require('./src/store');
const init = require('./src/init');
// MEDIASOUP_ENABLED controls whether the WebRTC SFU is loaded.
// Set to 'true' only on servers that have native build tools (gcc, python3, make).
// Glitch / shared hosts: leave unset or 'false' — API + Socket.IO still fully functional.
// Local Docker / VPS with Dockerfile: set to 'true'.
const mediasoupEnabled = process.env.MEDIASOUP_ENABLED === 'true';
const mediasoup = mediasoupEnabled ? require('./src/mediasoup') : null;

Config = require('./config');

// Health check — registered BEFORE the DB-availability gate so it always responds.
// Used by Docker Compose healthchecks and load balancers.
app.use('/healthz', require('./src/routes/health'));

app.use((req, res, next) => (store.connected ? next() : res.status(500).send('Database not available.')));

app.use(express.static(`${__dirname}/../frontend/dist`));
app.use('/login', express.static(`${__dirname}/../frontend/dist`));
app.use('/login/*', express.static(`${__dirname}/../frontend/dist`));
app.use('/admin', express.static(`${__dirname}/../frontend/dist`));
app.use('/room/*', express.static(`${__dirname}/../frontend/dist`));
app.use('/meeting/*', express.static(`${__dirname}/../frontend/dist`));

const server = http.createServer(app);
store.app = app;
store.config = Config;
// Socket.IO's engine.io transport does its own CORS check, independent of
// Express's cors() middleware above — without this, the initial polling/
// websocket handshake is rejected as cross-origin before any app-level auth
// logic runs, and every socket silently fails to connect in a browser.
store.io = io(server, { cors: { origin: Config.corsOrigin, credentials: true } });

const startServer = async () => {
  await setupRedisAdapter(store.io, Config.redisUrl);
  init(mediasoupEnabled);
  if (mediasoupEnabled && mediasoup) {
    mediasoup.init();
    logger.info('Mediasoup SFU enabled');
  } else {
    logger.info('Mediasoup SFU disabled (MEDIASOUP_ENABLED != true) — API-only mode');
  }
  // Best-effort, same posture as the Redis adapter above — no worker means
  // enqueued cleanup jobs simply wait in Redis until a worker process picks
  // them up, never a boot crash or lost job.
  startGroupCleanupWorker();
};

const listen = () => server.listen(Config.port, () => logger.info(`Server listening on port ${Config.port}`));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    logger.warn('Specified port unavailable, retrying in 10 seconds...');
    setTimeout(() => {
      server.close();
      server.listen(Config.port);
    }, Config.retryAfter);
  }
});

listen();
startServer().catch((err) => logger.error({ err }, 'startServer failed'));

let scheduler;
let schedulerDone = false;

const schedule = require('node-schedule');
const Email = require('./src/models/Email');
const sendMail = require('./src/utils/sendMail');

// Cron jobs

if (Config.nodemailerEnabled) {
  if (!scheduler)
    scheduler = schedule.scheduleJob('*/5 * * * * *', async () => {
      if (schedulerDone) {
        return;
      } else {
        schedulerDone = true;
      }

      // Mailer cron job — MAX_ATTEMPTS caps retries so a persistently broken
      // SMTP relay (bad credentials, provider outage) doesn't retry the same
      // doomed email every 5s forever; it's parked (sent stays false,
      // attempts maxed) for manual/log inspection instead of silently
      // hammering the provider indefinitely.
      const MAX_ATTEMPTS = 5;
      const emails = await Email.find({ sent: false, attempts: { $lt: MAX_ATTEMPTS } });

      for (let email of emails) {
        try {
          const html = `${email.html}`;
          await sendMail({
            from: email.from,
            to: email.to,
            subject: email.subject,
            html,
          });
          const entry = await Email.findById(email._id);
          entry.sent = true;
          entry.dateSent = Date.now();
          await entry.save();
        } catch (e) {
          logger.error({ err: e }, 'Failed to send scheduled email');
          // e.message only (SMTP response text/code) — never the configured
          // credentials, which nodemailer/pino never surface on the error.
          await Email.updateOne(
            { _id: email._id },
            { $inc: { attempts: 1 }, $set: { lastError: e.message } },
          );
        }
      }

      schedulerDone = false;
    });
}
