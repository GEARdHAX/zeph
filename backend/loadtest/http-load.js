// Phase 8 HTTP load test — plain Node fetch + FormData, no autocannon/
// artillery/k6 dependency (none was already installed; stdlib does
// everything this needs: fire N concurrent requests, record wall-clock
// latency, compute percentiles). Run against a REAL running backend (see
// loadtest/README.md for how to point it at local, non-shared infra) —
// this is not a mock.
//
// express-formidable (this backend's body parser, see index.js) reads
// req.fields from multipart bodies, not JSON — every POST here uses
// FormData for that reason, matching what the real frontend actually sends.
//
// B/C/D use a pool of users seeded directly via loadtest/seed.js (model
// layer, not HTTP) — POST /api/register+/api/login are correctly
// rate-limited to 20/15min per source IP (authLimiter, init.js), and a
// load test should measure that limit, not defeat it. Real traffic only
// registers a user once; hammering registration concurrently isn't what
// this suite is trying to measure for B/C/D anyway.
//
// Usage: node loadtest/http-load.js [concurrency] [baseUrl]
//   node loadtest/http-load.js 100 http://127.0.0.1:4099

const { execSync } = require('child_process');
const path = require('path');
const { summarize, printSummary } = require('./lib/percentiles');

const concurrency = Number(process.argv[2]) || 50;
const baseUrl = process.argv[3] || 'http://127.0.0.1:4099';

const timeRequest = async (fn) => {
  const start = process.hrtime.bigint();
  let ok = true;
  let detail;
  try {
    await fn();
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return {
    ms, ok, detail,
  };
};

const runBatch = async (label, fn, n) => {
  const results = await Promise.all(Array.from({ length: n }, (_, i) => timeRequest(() => fn(i))));
  const latencies = results.map((r) => r.ms);
  const errors = results.filter((r) => !r.ok);
  const stats = summarize(latencies, { errors: errors.length, total: n });
  printSummary(label, stats);
  if (errors.length > 0) console.error(`  [first error] ${errors[0].detail}`);
  return stats;
};

const form = (fields) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) f.append(k, v); });
  return f;
};

// ── A. Registration + login — deliberately small, respects the real
// 20/15min per-IP authLimiter. This IS the measured capacity number for
// this endpoint from one source IP, not a harness limitation to work around.
const AUTH_BATCH_SIZE = 8;
const registerAndLogin = async (i) => {
  const tag = `${Date.now()}${i}${Math.floor(Math.random() * 1e6)}`;
  const email = `loadtest-${tag}@example.com`;
  const username = `lt${tag}`;
  const reg = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    body: form({
      username, email, password: 'LoadTest123!', repeatPassword: 'LoadTest123!', firstName: 'Load', lastName: 'Test',
    }),
  });
  if (!reg.ok) throw new Error(`register ${reg.status}`);
  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    body: form({ email, password: 'LoadTest123!' }),
  });
  if (!login.ok) throw new Error(`login ${login.status}`);
};

const main = async () => {
  console.log(`Phase 8 HTTP load test — concurrency=${concurrency}, target=${baseUrl}`);

  const health = await fetch(`${baseUrl}/health/ready`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`Target ${baseUrl} is not reachable/ready — aborting. Start the backend first.`);
    process.exit(1);
  }

  await runBatch(
    `A. Register + Login (bounded to ${AUTH_BATCH_SIZE} — authLimiter is 20/15min/IP, register+login share the bucket)`,
    (i) => registerAndLogin(i),
    AUTH_BATCH_SIZE,
  );

  // Seed a large pool for B/C/D — bypasses authLimiter by design (see file
  // header). +1 spare so C/D always have a distinct counterpart to pair with.
  console.log(`\nSeeding ${concurrency + 1} users directly via the model layer for B/C/D...`);
  const seedOut = execSync(`node "${path.join(__dirname, 'seed.js')}" ${concurrency + 1}`, {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const { tokens, userIds } = JSON.parse(seedOut.trim().split('\n').pop());
  console.log(`Seeded ${tokens.length} users.`);

  // B. HTTP API: authenticated read (list rooms) — cheap, common, every
  // client hits this on load/reconnect.
  await runBatch('B. POST /api/rooms/list (list rooms, authenticated)', async () => {
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    const res = await fetch(`${baseUrl}/api/rooms/list`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form({}),
    });
    if (!res.ok) throw new Error(String(res.status));
  }, concurrency);

  // C. DM creation (idempotent upsert path — create-room.js's dmKey) between
  // distinct pairs.
  await runBatch('C. POST /api/room/create (create/open DM)', async (i) => {
    const res = await fetch(`${baseUrl}/api/room/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens[i]}` },
      body: form({ counterpart: userIds[i + 1] }),
    });
    if (!res.ok) throw new Error(String(res.status));
  }, concurrency);

  // D. DM messaging — reuses the DMs C. just created, exercising the
  // idempotent clientID path (Phase 8) under real concurrency.
  const rooms = [];
  const prepResults = await Promise.all(Array.from({ length: concurrency }, async (_, i) => {
    try {
      const res = await fetch(`${baseUrl}/api/room/create`, {
        method: 'POST', headers: { Authorization: `Bearer ${tokens[i]}` }, body: form({ counterpart: userIds[i + 1] }),
      });
      if (!res.ok) return { ok: false, detail: `${res.status} ${await res.text().catch(() => '')}` };
      const body = await res.json();
      if (!body.room || !body.room._id) return { ok: false, detail: `no room in body: ${JSON.stringify(body).slice(0, 200)}` };
      rooms.push({ roomID: body.room._id, senderToken: tokens[i] });
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }));
  const prepFailure = prepResults.find((r) => !r.ok);
  if (prepFailure) console.error(`  [setup] a room-create prep call failed: ${prepFailure.detail}`);
  console.log(`Prepared ${rooms.length} rooms for message-send batch.`);

  await runBatch('D. POST /api/message (DM send)', async (i) => {
    const r = rooms[i % rooms.length];
    if (!r) throw new Error('no room available');
    const res = await fetch(`${baseUrl}/api/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r.senderToken}` },
      body: form({
        roomID: r.roomID, content: `load test message ${i}`, type: 'text', clientID: `lt-${Date.now()}-${i}`,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
  }, concurrency);

  console.log('\nDone.');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
