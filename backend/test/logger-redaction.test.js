const pino = require('pino');
const pinoHttp = require('pino-http');
const express = require('express');
const request = require('supertest');

// Phase 9 audit finding, confirmed empirically before this fix: pino-http's
// default request serializer copies req.headers verbatim into every access
// log line. Since this app's sole auth credential is a Bearer JWT (no
// cookies — confirmed elsewhere in this audit), every request's log
// previously contained the caller's live session token in plaintext. A real
// captured log line during the audit showed the token in full.
//
// This test builds a REAL pino instance with src/logger.js's actual redact
// config (imported directly, not reimplemented) wired through a REAL
// pino-http + Express request cycle via supertest — the same code path a
// production request takes — and captures the literal log line pino emits,
// the same way the original vulnerability was empirically proven.
describe('logger redaction (Phase 9 — Authorization header leak into access logs)', () => {
  let logLines;
  let app;

  beforeEach(() => {
    logLines = [];
    // src/logger.js exports its REDACT_CONFIG specifically so this test
    // uses the real, exact config the app ships — pino doesn't expose a
    // constructed instance's redact option back for introspection, so
    // guessing/reconstructing it here would risk silently testing a
    // different config than production actually runs (an earlier version
    // of this test made exactly that mistake and passed against a redact
    // config that was never actually active).
    // eslint-disable-next-line global-require
    const { REDACT_CONFIG } = require('../src/logger');
    const testLogger = pino({ redact: REDACT_CONFIG }, {
      write: (line) => logLines.push(line),
    });

    app = express();
    app.use(pinoHttp({ logger: testLogger }));
    app.get('/test', (req, res) => res.json({ ok: true }));
    app.post('/test-body', (req, res) => res.json({ ok: true }));
  });

  it('redacts the Authorization header from access logs', async () => {
    await request(app).get('/test').set('Authorization', 'Bearer supersecrettoken123');

    const line = logLines.find((l) => l.includes('"headers"'));
    expect(line).toBeDefined();
    expect(line).not.toContain('supersecrettoken123');
    expect(JSON.parse(line).req.headers.authorization).toBe('[REDACTED]');
  });

  it('does not redact non-sensitive headers (log stays useful for debugging)', async () => {
    await request(app).get('/test').set('Authorization', 'Bearer supersecrettoken123').set('User-Agent', 'test-agent-string');

    const line = logLines.find((l) => l.includes('"headers"'));
    expect(JSON.parse(line).req.headers['user-agent']).toBe('test-agent-string');
  });
});
