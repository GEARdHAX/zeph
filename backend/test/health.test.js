const request = require('supertest');
const express = require('express');
const db = require('./helpers/db');
const health = require('../src/routes/health');
const store = require('../src/store');
const config = require('../config');
const { buildApp } = require('./helpers/app');

let app;

beforeAll(() => {
  store.config = { ...config, redisUrl: null }; // no Redis in this suite — readiness should treat "not configured" as fine, not degraded
  app = express();
  app.get('/healthz', health);
  app.get('/health/live', health.live);
  app.get('/health/ready', health.ready);
});

describe('GET /healthz (readiness — backward-compatible default export)', () => {
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

// Phase 7 audit finding: there was no separate liveness-only endpoint —
// every consumer (Docker healthcheck, /api/health) hit the SAME Mongo-
// dependent readiness check, so a slow/degraded DB could make an
// orchestrator think the PROCESS itself needed restarting.
describe('GET /health/live', () => {
  it('always reports ok, never touching Mongo — even with no DB connection at all', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /health/ready', () => {
  it('reports degraded before any DB connection exists', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('disconnected');
  });

  it('reports ok with a live Mongo ping once connected, and redis:"not_configured" (not degraded) when REDIS_URL is unset', async () => {
    await db.connect();
    try {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('connected');
      expect(res.body.redis).toBe('not_configured');
    } finally {
      await db.closeDatabase();
    }
  });

  it('reports degraded when Redis IS configured but unreachable', async () => {
    await db.connect();
    const original = store.config;
    store.config = { ...config, redisUrl: 'redis://127.0.0.1:1' }; // a port nothing listens on — guaranteed unreachable, fails fast
    try {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.redis).toBe('unreachable');
    } finally {
      store.config = original;
      await db.closeDatabase();
      // eslint-disable-next-line global-require
      const { closeQueueConnection } = require('../src/queues/connection');
      await closeQueueConnection();
    }
  }, 5000);
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

  it('/api/health/live is reachable through the real router', async () => {
    const realApp = buildApp();
    const res = await request(realApp).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('/api/health/ready is reachable through the real router', async () => {
    const realApp = buildApp();
    const res = await request(realApp).get('/api/health/ready');
    expect([200, 503]).toContain(res.status);
    expect(res.body.status).toBeDefined();
  });
});
