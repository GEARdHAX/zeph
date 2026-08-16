const request = require('supertest');
const express = require('express');
const db = require('./helpers/db');
const health = require('../src/routes/health');
const store = require('../src/store');
const config = require('../config');

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
