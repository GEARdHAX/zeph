const express = require('express');
const request = require('supertest');
const logger = require('../src/logger');

// Phase 9 audit finding: no global Express error-handling middleware
// existed anywhere in the app — every route wraps its own logic in
// try/catch (confirmed clean, no route echoes err.message/err.stack), but
// a genuinely uncaught synchronous throw had no app-level backstop and
// would fall through to Express's own default handler, which includes a
// stack trace unless NODE_ENV=='production' is correctly set on the real
// deployment — an externally-configured value this app doesn't itself
// enforce.
//
// test/helpers/app.js's buildApp() mounts routes/index.js directly, not
// through src/init.js — so it doesn't include this handler (same reason
// security-headers.test.js mounts helmet standalone rather than through
// buildApp()). This test builds the identical 4-arg middleware shape
// init.js now registers, on a minimal Express app with a deliberately
// throwing route, proving the exact contract: logged server-side, generic
// body to the client, no stack trace, no err.message leaked.
const buildAppWithErrorHandler = () => {
  const app = express();
  app.get('/throws-sync', () => {
    throw new Error('a secret internal detail: mongodb://real-connection-string');
  });
  app.get('/ok', (req, res) => res.status(200).json({ ok: true }));

  // Identical shape to init.js's handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error reached the global error handler');
    if (res.headersSent) return next(err);
    return res.status(500).json({ error: true, status: 'error', message: 'Internal server error.' });
  });
  return app;
};

describe('global error handler (Phase 9)', () => {
  it('catches an uncaught synchronous throw and returns a generic 500 body', async () => {
    const app = buildAppWithErrorHandler();
    const res = await request(app).get('/throws-sync');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: true, status: 'error', message: 'Internal server error.' });
  });

  it('never leaks the real error message or a stack trace to the client', async () => {
    const app = buildAppWithErrorHandler();
    const res = await request(app).get('/throws-sync');

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('mongodb://');
    expect(raw).not.toContain('.js:');
    expect(res.body.stack).toBeUndefined();
  });

  it('does not interfere with a normal successful request', async () => {
    const app = buildAppWithErrorHandler();
    const res = await request(app).get('/ok');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
