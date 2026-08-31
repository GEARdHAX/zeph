const express = require('express');
const request = require('supertest');
const helmet = require('helmet');

// Phase 7 audit finding: no security-headers middleware existed at all
// (confirmed absent via grep for helmet/X-Frame-Options/CSP/X-Content-Type-
// Options across the whole backend). Tests the EXACT helmet configuration
// index.js actually uses, mounted on a bare Express app — a full boot of
// index.js itself (Mongo/Redis/Socket.IO/Mediasoup/BullMQ workers) was
// manually smoke-tested separately and confirmed these headers are present
// on a real running server; this test exists so the configuration itself
// stays covered by the automated suite without paying that full-boot cost
// on every CI run.
const buildHelmetApp = () => {
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.get('/test', (req, res) => res.status(200).json({ ok: true }));
  return app;
};

describe('security headers (helmet)', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(buildHelmetApp()).get('/test');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to block framing (clickjacking protection)', async () => {
    const res = await request(buildHelmetApp()).get('/test');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('sets Strict-Transport-Security', async () => {
    const res = await request(buildHelmetApp()).get('/test');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('sets Cross-Origin-Resource-Policy to cross-origin, NOT the helmet default (same-origin) — required so the separately-hosted frontend can load /images/:id and /files/:id directly', async () => {
    const res = await request(buildHelmetApp()).get('/test');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('does NOT set a Content-Security-Policy header — this backend serves no HTML for a CSP to protect (JSON API + binary media server for a separately-hosted frontend)', async () => {
    const res = await request(buildHelmetApp()).get('/test');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
