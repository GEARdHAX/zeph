require('colors');
require('dotenv').config();

const logger = require('./src/logger');
const pinoHttp = require('pino-http');
const helmet = require('helmet');

// Phase 8 failure-injection finding: a Redis outage mid-request could crash
// the ENTIRE process — traced to an unhandled promise rejection from a
// dependency's fire-and-forget internal call (see setupRedisAdapter.js's
// comment for the exact mechanism and root-cause fix). That specific cause
// is fixed at the source; this is the defense-in-depth backstop so any
// OTHER unhandled rejection (this app's own code, or a future dependency)
// logs and keeps running instead of silently killing the process the way
// Node's default behavior does. Never crashes by itself — only logs.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection — see stack for origin');
});

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
// Phase 7 audit finding: no security-headers middleware existed at all
// (X-Content-Type-Options, X-Frame-Options, HSTS, etc. were all absent).
// crossOriginResourcePolicy is relaxed to 'cross-origin' (helmet's default
// is 'same-origin', which would break /images/:id and /files/:id — the
// documented current deployment (Cloudflare Pages, a DIFFERENT origin)
// loads these directly into <img>/<a> tags; CORS is the actual access-
// control boundary for this API, not CORP).
//
// Phase 9 audit finding, correcting Phase 7's own rationale here: this
// backend is NOT purely a JSON API — express.static(frontend/dist) below
// DOES serve the built frontend's HTML/JS whenever a deployment relies on
// that fallback (Serv00/Render/local Docker without a separately-hosted
// frontend origin — see infra/serv00.md, infra/render.md,
// frontend/Dockerfile's own "served by the backend's static middleware OR
// Cloudflare Pages" comment). In the documented current topology
// (Cloudflare Pages serves the frontend — PHASE8-BASELINE.md), this static
// mount is unreached and CSP genuinely has nothing to protect; on any
// deployment that falls back to it, serving that HTML with NO CSP at all
// means zero defense-in-depth against a future XSS bug (the app's actual
// current XSS posture is strong — no dangerouslySetInnerHTML anywhere,
// confirmed by this same audit pass — but CSP is exactly the backstop for
// the day that stops being true). Left disabled rather than shipping an
// unverified policy blind: a wrong CSP silently breaks the one deployment
// path that would actually need it, which is worse than no CSP at this
// moment. Enabling this correctly requires testing a real production Vite
// build against a real candidate policy — tracked as a known gap (see
// docs/PHASE9-SECURITY-REPORT.md) rather than guessed at here.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// gzip/br response compression — meaningful payload savings on slow/metered mobile connections.
app.use(compression());
const http = require('http');
const io = require('socket.io');
// Same mongoose singleton init.js's own mongooseConnect() uses (Node's
// require cache means this is the identical connection object, not a
// second one) — needed here only for gracefulShutdown()'s
// mongoose.connection.close() call.
const mongoose = require('mongoose');
const setupRedisAdapter = require('./src/setupRedisAdapter');
const { startGroupCleanupWorker } = require('./src/queues/groupCleanupWorker');
const { startSecurityAiWorker } = require('./src/queues/securityAiWorker');
const store = require('./src/store');
const init = require('./src/init');
// MEDIASOUP_ENABLED controls whether the WebRTC SFU is loaded.
// Set to 'true' only on servers that have native build tools (gcc, python3, make).
// Glitch / shared hosts: leave unset or 'false' — API + Socket.IO still fully functional.
// Local Docker / VPS with Dockerfile: set to 'true'.
const mediasoupEnabled = process.env.MEDIASOUP_ENABLED === 'true';
const mediasoup = mediasoupEnabled ? require('./src/mediasoup') : null;

Config = require('./config');

// Health checks — registered BEFORE the DB-availability gate so they always
// respond. Used by Docker Compose healthchecks and load balancers.
// /healthz is kept as an alias of /health/ready for backward compatibility
// with docker-compose.yml/docker-compose.prod.yml's existing healthcheck
// commands, which curl this exact path — Phase 7 audit finding: previously
// this WAS the readiness check (Mongo-ping) with no separate liveness-only
// endpoint, so any orchestrator/monitor pointed at it already gets the
// readiness semantics it always had; /health/live is new, genuinely cheap
// (never touches Mongo/Redis), for callers that specifically want "is the
// process alive" without readiness's dependency checks.
const health = require('./src/routes/health');
app.get('/health/live', health.live);
app.get('/health/ready', health.ready);
app.use('/healthz', health);

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

// Phase 7 — populated once startServer() actually creates them, so
// gracefulShutdown() below has real handles to close. Module-level (not
// function-locals) for the same reason setupRedisAdapter.js's pubClient/
// subClient were just promoted to module scope: shutdown needs to reach them.
let groupCleanupWorker = null;
let securityAiWorker = null;

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
  groupCleanupWorker = startGroupCleanupWorker();
  securityAiWorker = startSecurityAiWorker();
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

// ── Graceful shutdown (Phase 7) ──────────────────────────────────────────
// Audit finding: no SIGTERM/SIGINT handler existed anywhere — on every
// deploy/restart, none of the 9 independent Redis connections were closed,
// Mongo was never explicitly closed, BullMQ workers were killed mid-job
// rather than drained, the HTTP server was never .close()d, and Mediasoup
// workers were never closed. This handler closes everything this process
// opened, in dependency order (stop taking new work first, then drain,
// then close each backing store), with a bounded timeout so a stuck
// close() can never hang the process indefinitely — same "never allow
// shutdown to hang" requirement the security/reliability work in earlier
// phases already applies to individual operations (AI timeouts, circuit
// breakers), now applied to the process lifecycle itself.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;
let shuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (shuttingDown) return; // a second SIGTERM/SIGINT while already shutting down is a no-op, not a re-entrant shutdown
  shuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received, closing gracefully');

  const forceExitTimer = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown exceeded timeout, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // 1. Stop the mailer cron from picking up new work.
    if (scheduler) scheduler.cancel();

    // 2. Stop accepting new HTTP connections (existing in-flight requests
    // still complete — http.Server.close() waits for those).
    await new Promise((resolve) => server.close(() => resolve()));

    // 3. Stop accepting new Socket.IO connections and close existing ones.
    // Socket.IO's own close() also stops the underlying engine.io server.
    await new Promise((resolve) => store.io.close(() => resolve()));

    // 4. Stop BullMQ workers — .close() waits for any in-flight job in that
    // worker to finish (up to BullMQ's own internal grace period) rather
    // than killing it mid-processing.
    await Promise.all([
      groupCleanupWorker ? groupCleanupWorker.close() : Promise.resolve(),
      securityAiWorker ? securityAiWorker.close() : Promise.resolve(),
    ]);

    // 5. Close every independent Redis connection this process opened —
    // the BullMQ connection, the Socket.IO adapter's pub/sub pair, and
    // every Phase 2-6 cache/dedup client. All of these already export a
    // close*Connection() that was previously only ever called from tests.
    const { closeQueueConnection } = require('./src/queues/connection');
    const { closeRedisAdapterConnections } = require('./src/setupRedisAdapter');
    const { closeProfileCacheConnection } = require('./src/userProfileCache');
    const { closeThreatIntelCacheConnection } = require('./src/services/threatIntel/cache');
    const { closeRiskCacheConnection } = require('./src/services/zeroTrust/riskCache');
    const { closeSensorDedupConnection } = require('./src/services/ebpf/sensorEventDedup');
    const { closeNetworkIntelConnection } = require('./src/services/networkIntel/cache');
    const { closeSecurityAiCacheConnection } = require('./src/services/securityAi/cache');
    await Promise.all([
      closeQueueConnection(),
      closeRedisAdapterConnections(),
      closeProfileCacheConnection(),
      closeThreatIntelCacheConnection(),
      closeRiskCacheConnection(),
      closeSensorDedupConnection(),
      closeNetworkIntelConnection(),
      closeSecurityAiCacheConnection(),
    ]);

    // 6. Close Mongo.
    await mongoose.connection.close();

    // 7. Close Mediasoup, if it was ever started — closing the worker
    // cascades to close every router/transport/producer/consumer it owns.
    if (mediasoupEnabled && mediasoup && mediasoup.close) {
      await mediasoup.close();
    }

    clearTimeout(forceExitTimer);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during graceful shutdown');
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
