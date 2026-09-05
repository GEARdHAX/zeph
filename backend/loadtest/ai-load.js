// Zeph AI — Phase 12 AI load test. Plain Node fetch, no autocannon/artillery/
// k6 dependency, same convention as http-load.js/message-only-load.js.
//
// IMPORTANT — what this measures vs. does not measure:
// This exercises the REAL Zeph AI governance pipeline (route auth ->
// eligibility -> quota -> dedup lock -> gateway -> output validation ->
// persistence) against a REAL running backend + REAL local Redis/Mongo.
// The actual "provider call" step talks to loadtest/mock-groq-server.js
// (see that file's own header) — a local, zero-cost stand-in — NOT the real
// Groq API. Every "provider latency" number below is therefore a SIMULATED
// figure bounded by the mock server's artificial delay, not Groq's real
// production latency. This script never claims otherwise; report readers
// should not either.
//
// Usage:
//   node loadtest/mock-groq-server.js &
//   GROQ_BASE_URL=http://127.0.0.1:4098 AI_PROVIDER=groq GROQ_API_KEY=test node index.js &
//   node loadtest/ai-load.js [concurrency] [baseUrl]
//
// Rate limiters you will hit — same "this is expected, not a bug" posture
// as loadtest/README.md documents for the other scripts: `aiLimiter`
// (init.js) is a single 15-requests-per-15-minutes-per-IP ceiling shared by
// EVERY /api/ai/* route. Since every scenario below runs from one source IP
// in sequence, scenario A alone can consume most/all of that budget, and
// later scenarios (C, D, E) will then show 429s that reflect the IP
// ceiling, not scenario D's own per-user burst logic. To measure each
// scenario's OWN behavior in isolation (not interference from an earlier
// scenario's IP-budget consumption), restart the backend between runs
// (a fresh process resets aiLimiter's in-memory state) — same as
// http-load.js's own documented workflow.
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { summarize, printSummary } = require('./lib/percentiles');

const writeTempJson = (data) => {
  const file = path.join(os.tmpdir(), `zeph-ai-load-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
};

const concurrency = Number(process.argv[2]) || 20;
const baseUrl = process.argv[3] || 'http://127.0.0.1:4099';

const timeRequest = async (fn) => {
  const start = process.hrtime.bigint();
  let ok = true;
  let detail;
  let status;
  try {
    status = await fn();
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return {
    ms, ok, detail, status,
  };
};

const runBatch = async (label, fn, n) => {
  const results = await Promise.all(Array.from({ length: n }, (_, i) => timeRequest(() => fn(i))));
  const latencies = results.map((r) => r.ms);
  const errors = results.filter((r) => !r.ok);
  const stats = summarize(latencies, { errors: errors.length, total: n });
  printSummary(label, stats);
  if (errors.length > 0) console.error(`  [first error] ${errors[0].detail}`);
  return { stats, results };
};

const form = (fields) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) f.append(k, v); });
  return f;
};

const main = async () => {
  console.log(`Zeph AI load test — concurrency=${concurrency}, target=${baseUrl}`);

  const health = await fetch(`${baseUrl}/health/ready`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`Target ${baseUrl} is not reachable/ready — aborting. Start the backend first (with AI_PROVIDER=groq pointed at loadtest/mock-groq-server.js — see this file's header).`);
    process.exit(1);
  }

  console.log(`\nSeeding ${concurrency + 1} users + a group room with ${concurrency > 100 ? 105 : 105} eligible messages...`);
  const seedOut = execSync(`node "${path.join(__dirname, 'seed.js')}" ${concurrency + 1}`, {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const { tokens, userIds } = JSON.parse(seedOut.trim().split('\n').pop());
  console.log(`Seeded ${tokens.length} users.`);

  // A shared group room with enough messages to clear the default
  // group-summary eligibility floor (100) — created directly via the model
  // layer (same reasoning as seed.js: a load test measures AI governance,
  // not group-creation/message-send throughput, which http-load.js already
  // covers separately).
  const groupUserIdsFile = writeTempJson(userIds.slice(0, Math.min(10, userIds.length)));
  const seedGroupOut = execSync(
    `node "${path.join(__dirname, 'seed-ai-room.js')}" "${groupUserIdsFile}" 105`,
    { cwd: path.join(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  const { roomId } = JSON.parse(seedGroupOut.trim().split('\n').pop());
  console.log(`Seeded group room ${roomId} with 105 eligible messages.`);

  // A. Concurrent IDENTICAL summary requests for the SAME group — the
  // "5 users request the same group summary simultaneously" scenario
  // (Phase 12). Dedup effectiveness = how many of these N requests actually
  // reached the provider vs. reused a lock/cache — inferred here from
  // status codes: 200 with cached:true, or 202 GENERATING, both mean "did
  // not trigger an independent provider call."
  const dedupTokens = tokens.slice(0, Math.min(concurrency, tokens.length));
  const { results: dedupResults } = await runBatch(
    `A. ${dedupTokens.length} CONCURRENT identical group-summary requests (dedup test)`,
    async (i) => {
      const res = await fetch(`${baseUrl}/api/ai/summarize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${dedupTokens[i]}` },
        body: form({ roomID: roomId }),
      });
      return res.status;
    },
    dedupTokens.length,
  );
  const dedupOutcomes = dedupResults.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`  status code breakdown: ${JSON.stringify(dedupOutcomes)}`);
  console.log('  (200/202 codes here reflect the SAME provider call\'s result being reused or a single queued job — not N independent provider calls; see server logs for ai_dedup_in_progress/ai_cache_hit counts for the authoritative count)');

  // B. Repeated requests for an ALREADY-cached summary — cache-hit path.
  await runBatch(
    'B. Repeated requests for an already-cached summary (cache-hit path)',
    async (i) => {
      const res = await fetch(`${baseUrl}/api/ai/summarize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${dedupTokens[i % dedupTokens.length]}` },
        body: form({ roomID: roomId }),
      });
      return res.status;
    },
    dedupTokens.length,
  );

  // C. Translate — lightweight, synchronous, no dedup key. Measures raw
  // governed-request throughput for the simplest AI feature shape.
  await runBatch(
    'C. POST /api/ai/translate (concurrent, distinct users)',
    async (i) => {
      const res = await fetch(`${baseUrl}/api/ai/translate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens[i % tokens.length]}` },
        body: form({ text: `load test message ${i}`, targetLanguage: 'French' }),
      });
      return res.status;
    },
    concurrency,
  );

  // D. Burst — same small set of users firing requests back-to-back,
  // deliberately exceeding the default per-user-per-minute quota (5) to
  // observe real 429 behavior (Phase 12: "Groq rate limiting" /
  // "burst traffic").
  const burstUser = tokens[0];
  const burstSize = 15; // > default AI_LIMIT_USER_PER_MINUTE (5) — expect real 429s past request 5
  const { results: burstResults } = await runBatch(
    `D. Burst — ${burstSize} rapid requests from ONE user (default per-minute quota is 5)`,
    async (i) => {
      const res = await fetch(`${baseUrl}/api/ai/rewrite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${burstUser}` },
        body: form({ text: `burst message ${i}` }),
      });
      return res.status;
    },
    burstSize,
  );
  const burst429s = burstResults.filter((r) => r.status === 429).length;
  console.log(`  429 (quota/rate-limited) responses: ${burst429s}/${burstSize}`);

  // E. Large conversation — summarize a room with many more messages than
  // the context budget, to exercise the context-builder trim path under load.
  const largeUserIdsFile = writeTempJson(userIds.slice(0, 2));
  const seedLargeOut = execSync(
    `node "${path.join(__dirname, 'seed-ai-room.js')}" "${largeUserIdsFile}" 500`,
    { cwd: path.join(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  const { roomId: largeRoomId } = JSON.parse(seedLargeOut.trim().split('\n').pop());
  await runBatch(
    'E. Large-conversation summary (500 messages, context-builder trim path)',
    async () => {
      const res = await fetch(`${baseUrl}/api/ai/summarize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens[0]}` },
        body: form({ roomID: largeRoomId }),
      });
      return res.status;
    },
    1,
  );

  console.log('\nDone. Every "provider latency"/"total latency" figure above is bounded by loadtest/mock-groq-server.js\'s artificial delay, not real Groq latency.');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
