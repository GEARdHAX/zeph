// Isolated message-send load test. Rooms are seeded directly via the model
// layer (seed-rooms.js), not through POST /api/room/create — that route
// sits behind discoveryLimiter (100/15min/IP), a real, correctly-scoped
// limit on room CREATION specifically (anti-enumeration/anti-spam), a
// different concern from message-send throughput. http-load.js's batch C
// already measures the room-creation number directly against that limiter;
// this script measures what /api/message's OWN limiters (messageSendLimit,
// 60/min PER USER — Phase 7 — and apiLimiter, 300/15min per IP, the
// general fallback every /api route not otherwise listed falls under)
// actually allow.
//
// Usage: node loadtest/message-only-load.js [concurrency] [baseUrl]

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { summarize, printSummary } = require('./lib/percentiles');

const concurrency = Number(process.argv[2]) || 50;
const baseUrl = process.argv[3] || 'http://127.0.0.1:4099';

const form = (fields) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) f.append(k, v); });
  return f;
};

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

const main = async () => {
  const health = await fetch(`${baseUrl}/health/ready`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`Target ${baseUrl} is not reachable/ready — aborting. Start the backend first (fresh, for a clean limiter window).`);
    process.exit(1);
  }

  console.log(`Seeding ${concurrency + 1} users + ${concurrency} DM rooms directly via the model layer...`);
  const seedOut = execSync(`node "${path.join(__dirname, 'seed.js')}" ${concurrency + 1}`, {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const usersFile = path.join(os.tmpdir(), `zeph-loadtest-users-${Date.now()}.json`);
  fs.writeFileSync(usersFile, seedOut.trim().split('\n').pop());

  const roomsOut = execSync(`node "${path.join(__dirname, 'seed-rooms.js')}" "${usersFile}"`, {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const { rooms } = JSON.parse(roomsOut.trim().split('\n').pop());
  fs.unlinkSync(usersFile);
  console.log(`Prepared ${rooms.length}/${concurrency} rooms.`);

  const results = await Promise.all(rooms.map((r, i) => timeRequest(async () => {
    const res = await fetch(`${baseUrl}/api/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${r.senderToken}` },
      body: form({
        roomID: r.roomID, content: `load test message ${i}`, type: 'text', clientID: `lt-${Date.now()}-${i}`,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
  })));

  const latencies = results.map((r) => r.ms);
  const errors = results.filter((r) => !r.ok);
  const stats = summarize(latencies, { errors: errors.length, total: results.length });
  printSummary(`POST /api/message — isolated, concurrency=${concurrency}`, stats);
  if (errors.length > 0) console.error(`  [first error] ${errors[0].detail}`);

  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
