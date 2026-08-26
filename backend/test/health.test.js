const request = require('supertest');
const express = require('express');
const db = require('./helpers/db');
const health = require('../src/routes/health');
const store = require('../src/store');
const config = require('../config');
const { buildApp } = require('./helpers/app');

let app;

beforeAll(() => {
  store.config = config;
  app = express();
  app.get('/healthz', health);
});

describe('GET /healthz', () => {
  it('reports degraded (not the old always-true store.connected flag) before any DB connection exists', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('disconnected');
  });

  it('reports ok with a live ping once genuinely connected', async () => {
    await db.connect();
    try {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('connected');
    } finally {
      await db.closeDatabase();
    }
  });
});

// Regression: health.js's handler existed and worked in isolation (the
// tests above prove that), but was never actually mounted in
// routes/index.js or init.js — docker-compose.yml's healthcheck
// (curl http://localhost:PORT/healthz) and any /api/health uptime monitor
// were both silently unreachable (connection/404, not a real health
// signal). This exercises the REAL router (via buildApp(), same as every
// other route's tests), not a hand-built Express app, so a future removal
// of the mount would be caught here.
describe('GET /api/health (mounted in the real router)', () => {
  it('is reachable through the actual app router, not just in isolation', async () => {
    const realApp = buildApp();
    const res = await request(realApp).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.status).toBeDefined();
  });
});
