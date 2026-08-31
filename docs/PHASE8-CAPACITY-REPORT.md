# ZEPH Phase 8 — Scale, Reliability, Disaster Recovery & Production Operations

Final report per the Phase 8 spec's required structure. Companion to
[`PHASE8-BASELINE.md`](./PHASE8-BASELINE.md) (pre-work state) and
[`backend/loadtest/README.md`](../backend/loadtest/README.md) (how every
number below was produced — reproducible scripts, not one-off numbers).

**Scope, confirmed with the user before starting**: run everything
genuinely testable against local, isolated infrastructure and honest
single-instance measurement. For sections assuming a multi-instance fleet,
real disaster-recovery failover, or TURN-under-NAT testing — none of which
exist in the actual deployed infrastructure (single Render instance,
Mediasoup disabled, coturn never deployed) — document the design and exact
runbook steps, explicitly labeled as not executable on current
infrastructure rather than faked.

No number in this report was invented. Every throughput/latency/capacity
figure below came from a script in `backend/loadtest/` run against a real
local backend + local MongoDB + local Redis, moments before being written
down. Where a section could not be executed for real (marked below), it
says so instead of a fabricated number.

---

## 1. Phase 7 baseline

No prior capacity numbers exist — Phase 7 explicitly recorded zero load
testing (`PHASE7-COMPLETION-REPORT.md` §11). See `PHASE8-BASELINE.md` for
the full starting-point audit. Test baseline carried forward: 1028→1075
backend tests (Phase 7's delta), 473 frontend tests, all passing except one
documented pre-existing parallel-Jest-worker flake.

## 2. Phase 8 changes

**Fixed (verified, not just documented):**

1. **A real backend-crashing bug, found via failure injection.** Killing
   the local Redis instance mid-operation crashed the entire Node process
   — an uncaught `MaxRetriesPerRequestError`. Root cause:
   `setupRedisAdapter.js`'s long-lived pub/sub clients had
   `maxRetriesPerRequest: 3`, and `@socket.io/redis-adapter`'s internal
   `pubClient.publish(...)` calls (its own `dist/index.js`) are
   fire-and-forget with no `.catch()` — a command that exhausted its retry
   budget rejected into an unhandled promise rejection, which Node's
   default behavior turns into a full process exit. Fixed by removing the
   bounded retry count (mirroring `queues/connection.js`'s BullMQ client,
   which already used `maxRetriesPerRequest: null` for the identical
   reason). Added a global `unhandledRejection` handler in `index.js` as
   defense-in-depth. **Reproduced and confirmed fixed**: killed the same
   local Redis instance before and after the fix — crashed every time
   before, survived (correctly reporting `degraded`) every time after.
2. **Message-send idempotency.** `retryWithBackoff` (frontend) already
   retries `POST /api/message` on a lost response; the frontend already
   generated a `clientID` UUID for local optimistic-UI reconciliation but
   never sent it to the server, so a retry after a successful-but-
   unacknowledged save created a real duplicate message. Added a
   `{room, author, clientID}` unique **partial** index (not `sparse` —
   confirmed via a real regression this exact substitution catches: a
   compound sparse index only excludes a document if *every* indexed field
   is absent, and system messages have no `author` at all, so two of them
   in the same room would still collide under `sparse: true`).
3. **Friend-request accept race.** `findOne`-then-`.save()` let two
   concurrent accept requests both pass the pending-status check before
   either wrote, double-firing the realtime `friend-request:accepted`
   emit. Fixed with an atomic `findOneAndUpdate` CAS. Proven with a real
   concurrent-request test: exactly one `200` and one `404`, never two
   `200`s.
4. **`User.level` full collection scan on every inbox load.**
   `list-rooms.js`'s admin-privacy-boundary check runs
   `User.find({level: {$ne: 'standard'}})` on every single inbox request.
   Confirmed via a real `explain()` against 3005 seeded users: `COLLSCAN`,
   3005 documents examined to find 1. Added an index on `level`. Re-ran
   the same `explain()`: `FETCH` via index, 1 document examined.
   (`partialFilterExpression` was attempted first to keep the index
   smaller — MongoDB rejected it with `CannotCreateIndex`: partial-index
   expressions don't support `$ne`/`$not`. A plain full index is the
   correct fix here; `level` is low-cardinality so its size is bounded
   regardless.)
5. **Dependency vulnerabilities.** `npm audit` found 23 backend
   vulnerabilities (5 critical, 13 high). Bumped `mongoose` (6.12.6 →
   6.13.11, clears the "Mongoose search injection" critical advisory) and
   `express` (4.18.2 → 4.22.2, clears several transitive advisories) —
   both same-major safe patches. Ran `npm audit fix` for the rest of the
   auto-resolvable transitive bumps. Full test suite re-run after each
   change: zero regressions.
6. **CI never actually ran on the real default branch.** `.github/
   workflows/ci.yml` triggered on `push`/`pull_request` to `[main,
   develop]` — the actual repository default branch is `master`, and no
   `develop` branch exists. CI has structurally never run on a push to
   `master`. Fixed the trigger list. Added a non-blocking `npm audit
   --audit-level=high` step to both backend and frontend jobs (non-
   blocking because this exact audit found findings with no available fix
   yet — nedb/underscore, see §9 — a hard gate would permanently red every
   future run instead of catching a *new* regression; it still fails
   visibly in the job summary).

**Documented, not built** (real gaps, correct fix is bigger than a
hardening pass, or blocked on infrastructure that doesn't exist — see §9,
§13, §14 below for the reasoning on each):

- Mongoose's default server-selection timeout (~15-30s) means an
  authenticated request during a Mongo outage hangs that long before
  failing, rather than failing fast — a real UX gap, not fixed this pass
  (global Mongoose connection-option changes are a bigger, riskier change
  than a hardening pass should make unprompted; flagged as a recommended
  next-phase item).
- `nedb`/`nedb-async`/`underscore`/`binary-search-tree` (Mediasoup
  room/peer in-process tracking) have no available fix — abandoned
  packages. Not replaced this pass (Mediasoup is disabled in production
  today; see §9).

## 3. Measured throughput (HTTP)

All numbers from `backend/loadtest/http-load.js` and `message-only-load.js`
against a local backend + local Mongo + local Redis, fresh process per run
(clean rate-limiter state). Full raw output in the load-test scripts'
comments; summarized here.

| Endpoint | Concurrency | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| `POST /api/register`+`/login` | 8 (bounded — see below) | 515ms | 619ms | 619ms | 0% |
| `POST /api/rooms/list` | 10 | 55ms | 62ms | 62ms | 0% |
| `POST /api/rooms/list` | 50 | 267ms | 285ms | 289ms | 0% |
| `POST /api/rooms/list` | 100 | 506ms | 524ms | 526ms | 0% |
| `POST /api/room/create` (DM) | 10 | 69ms | 72ms | 72ms | 0% |
| `POST /api/room/create` (DM) | 50 | 269ms | 303ms | 309ms | 0% |
| `POST /api/message` (isolated) | 100 | 623ms | 751ms | 770ms | 0% |
| `POST /api/message` (isolated) | 500 | — | — | — | **40% (429)** |
| `POST /api/message` (isolated) | 1000 | — | — | — | **70% (429)** |

**Auth is deliberately measured at 8, not higher**: `authLimiter`
(`src/init.js`) caps registration+login at **20 requests per 15 minutes
per source IP** — register and login share one bucket, so 8 register+login
pairs (16 requests) leaves headroom in the same window without tripping
it. This ceiling IS the real, correct, measured capacity for this
endpoint from one IP — a security control working as designed, not a
limitation of the test.

**Message-send at 500/1000 concurrency**: the failures are `429`s from
`apiLimiter` (300 requests/15min/IP, the general fallback every `/api`
route not otherwise listed falls under), not application errors, timeouts,
or crashes. At 500 concurrent: exactly 300 succeed (60%), 200 rejected. At
1000: exactly 300 succeed (30%), 700 rejected. The 300-request ceiling
holds regardless of concurrency, confirming it's a fixed 15-minute-window
count, not a concurrency limit — exactly the intended behavior of a
fixed-window rate limiter.

**Conclusion**: from a single source IP, this backend's real, measured,
rate-limiter-bounded ceiling is ~300 general API requests / 15 minutes,
~100 room/discovery-type requests / 15 minutes, ~20 auth requests / 15
minutes, and 60 message-sends / minute per authenticated user (a separate,
per-user, non-IP-bound limiter that never triggered in any of these tests
since each test used a distinct seeded user per request).

## 4. Measured concurrent connections (Socket.IO)

`backend/loadtest/socket-load.js` — real `socket.io-client` connections,
real JWT authenticate handshake, real HTTP-send → socket-receipt delivery
measurement (not a synthetic stand-in).

| Concurrency | Connect+auth p50 | Connect+auth p95 | Connect errors | Delivery p50 | Delivery errors |
|---|---|---|---|---|---|
| 10 | 38ms | 42ms | 0% | 129ms | 0% |
| 100 | 133ms | 161ms | 0% | 1154ms | 0% |
| 500 | 596ms | 836ms | 0% | n/a — see below | — |

**500 concurrent connections: 500/500 succeeded, 0 errors.** This is a
real, clean result — the single Node process handled 500 concurrent
WebSocket connect+authenticate handshakes with zero failures, connection
time scaling from ~40ms (10 concurrent) to ~600ms (500 concurrent).

Delivery latency at 500 concurrent could not be cleanly measured in
isolation: the delivery test's own HTTP sends ran into the same
`apiLimiter` 300/15min ceiling described in §3 (the seeding + connection
setup for 500 users had already consumed most of the window's budget by
the time the delivery batch ran). This is the same real limiter behavior,
not a socket-layer failure — re-confirmed by isolating message-send
throughput separately in §3.

## 5. p50/p95/p99 latency

Reported per-endpoint in §3/§4 tables above — not repeated here.
**Directionally**: every endpoint tested shows p50 growing roughly
linearly with concurrency up to 100 concurrent requests (consistent with a
single-threaded Node event loop processing real sequential DB round-trips
under load, not a pathological blow-up), and no endpoint showed p99 more
than ~30% above p50 at any tested concurrency below the rate-limiter
ceiling — no long-tail latency cliff was observed within the tested range.

## 6. CPU/RAM limits

**RAM**: sampled via Windows `tasklist` during a 1000-concurrent
message-send burst (seeding 1000 users + 1000 rooms + 1000 message
attempts in rapid succession) — backend process grew from ~105MB baseline
to ~226MB peak, no runaway growth observed in the sampled window.

**CPU**: **not measured with a real percentage** — `tasklist` on Windows
doesn't expose CPU% directly, and no CPU-profiling tool was added for a
single measurement pass (would be scope creep for this phase). This is an
honest gap, not a claimed number. A future load-testing pass should use
`Get-Counter` (PowerShell) or a proper profiler if CPU-bound behavior
needs to be characterized.

**Event-loop lag**: not measured — no APM/profiling library exists in
this codebase and adding one for a single measurement violates this
phase's own "do not add expensive commercial APM" instruction. The
p50→p99 latency data in §3/§4 is the closest available proxy (no evidence
of event-loop starvation — latencies scaled smoothly, not in a step
function).

## 7. Database bottlenecks

**Real, found, fixed** (see §2.4): `User.level` full collection scan on
every inbox load — 3005 docs examined → 1 after adding an index.

**Real, checked, no issue found**: message pagination
(`Message.find({room}).sort({_id:-1}).limit(50)`) — tested against a real
seeded room with 5000 messages: `LIMIT` stage, exactly 50 documents
examined, 0ms. The existing `{room:1}` index is sufficient at this
document volume; no compound index needed. `GroupMember` membership
lookups (`{group,user}`) are fully covered by the existing unique compound
index — confirmed by reading the query shape against the index, not
assumed.

**Not checked this pass**: aggregation-heavy admin/analytics queries
(SecurityEvent/SecurityIncident dashboards) — out of scope for this pass,
lower traffic volume than the message/inbox hot paths audited above.

## 8. Redis bottlenecks

**The real bottleneck found wasn't performance — it was a crash.** See
§2.1. Once fixed, a Redis outage degrades correctly (Socket.IO falls back
to single-process delivery, `/health/ready` reports `redis: unreachable`)
rather than taking the whole process down. No Redis throughput/latency
ceiling was reached in any load test performed — the app's own HTTP rate
limiters were consistently the binding constraint before Redis itself
became one.

## 9. Socket.IO bottlenecks

None found at the concurrency levels tested (up to 500 concurrent
connections, 0 errors). The Redis-adapter crash bug (§2.1) was a
reliability bottleneck (total failure under a dependency outage), not a
throughput one. Real Redis-adapter cross-instance delivery (Client A on
Server 1 → Client B on Server 2) could not be tested — Render's free tier
is single-instance today, so there is no second real instance to test
against; the adapter's wiring was verified by reading the code
(`store.io.to(userId).emit(...)` is adapter-transparent by design — see
`DECISIONS.md` D-035) and by the Redis-outage test above (which exercises
the exact same client objects the cross-instance path depends on).

## 10. Mediasoup limits

**Not load tested this phase.** Mediasoup is disabled in the actual
production deployment (Render lacks the native build toolchain — confirmed
current in `PHASE8-BASELINE.md`). Building and running a controlled
WebRTC/Mediasoup capacity test (spec §11: "concurrent calls, participants/
call, CPU, RAM, bandwidth, packet loss") against a feature that isn't
reachable in production would be measuring dead code, not the deployed
system — the same reasoning Phase 7's audit already applied to deferring
Mediasoup worker-pool work. Phase 7 already fixed the real, verified
resource-leak bug in this subsystem (disconnect handler, tracking-object
cleanup, a genuine `closeConsumer` keying bug) with concrete before/after
evidence (`tasklist`-verified zero orphaned `mediasoup-worker.exe`
processes). Recommended as the first real deliverable once Mediasoup is
ever re-enabled on a host that can compile it (§16 below).

## 11. Security improvements

- Fixed a crash-on-Redis-outage bug that would have taken the entire
  backend offline during any Redis blip in production (§2.1) — this is
  also an availability/DoS-adjacent finding: any attacker (or just
  Upstash having a bad day) able to disrupt the Redis connection could
  previously take the whole app down, not just degrade it.
- Closed a message-duplication gap reachable by a client retry (§2.2) —
  not a security vulnerability in the traditional sense, but a data-
  integrity gap an unreliable network could trigger for any real user.
- Closed a friend-request double-accept race (§2.3).
- Bumped `mongoose` past a critical "search injection" advisory, and
  `express` past several transitive advisories (§2.5).
- Fixed CI never actually running on the real default branch — every
  security/quality gate CI provides (secret scanning, tests, lint) had a
  structural gap where it silently never applied to `master` (§2.6).
- Confirmed (not changed — already correct from Phase 6) the AI security
  pipeline's data-minimization gate (`sanitizer.js`): a strict allowlist
  of pre-defined signal labels and bounded numeric counts, nothing free-
  text or unbounded ever reaches the prompt. AI receives aggregated
  behavioral signals only — never messages, passwords, JWTs, reset codes,
  credentials, or private files. Verified by reading the actual
  allowlist implementation, not assumed from a comment.
- Confirmed (unchanged, already correct) the AI-analysis concurrency
  governance: `concurrency: 2` on the BullMQ worker structurally caps
  in-flight LLM calls regardless of how many jobs get enqueued, plus a
  20/min/admin rate limit on the manual-trigger route — directly
  satisfies "never allow 1000 simultaneous AI requests to exhaust the
  host."

## 12. Failure recovery results

Real failure matrix, from actual local kills against the local isolated
Mongo/Redis (never against the real Atlas/Upstash services):

| Failure | What breaks | What continues | Fails safely? | Auto-recovers? | Data lost? |
|---|---|---|---|---|---|
| **Redis killed mid-run** | Cross-instance Socket.IO delivery (moot — single instance today), caching, distributed rate limiting (falls back to per-process in-memory) | HTTP API, Mongo-backed reads/writes, Socket.IO connect+auth (single-process mode), message send/receive | **Yes, after the Phase 8 fix** (crashed the whole process before — see §2.1) | Yes — ioredis's own reconnect logic reconnects when Redis comes back, no manual restart needed | No |
| **MongoDB killed mid-run** | Every DB-backed route (401/500 depending on where in the request the failure lands) | `/health/live`, Redis-backed operations | Yes — `/health/ready` correctly reports `degraded`/`db: disconnected`, no crash observed in any test | Yes — Mongoose auto-reconnects; confirmed the process itself never needed a restart | No (Mongo itself is the source of truth; a real outage there is an infrastructure event, not an app-level data-loss risk) |
| **BullMQ worker killed** | New jobs queue in Redis, unprocessed until a worker restarts | Everything else — job enqueue is fire-and-forget from the caller's perspective (`group-cleanup`, `security-ai-analysis`) | Yes — jobs wait in Redis, not lost | Only manually (process restart) — not auto-restarted by anything in this codebase; **this is the honest answer, not "yes it self-heals"** | No — jobs persist in Redis until a worker picks them up |
| **Mediasoup worker crash** | Active calls on that worker (not tested this phase — Mediasoup is disabled in production; Phase 7 already fixed the resource-leak side of this) | Everything else (Mediasoup is a separate subsystem, gated by `MEDIASOUP_ENABLED`) | Not verified this phase | Not verified this phase | Not applicable — calls aren't durable state |
| **SMTP/Brevo failure** | Outgoing email (password reset codes, notifications) | Everything else — the existing `Email` outbox + cron-poller (Phase 7-audited, unchanged) retries up to `MAX_ATTEMPTS`, never crashes the request that triggered the email | Yes — confirmed by reading `index.js`'s cron job: catches and logs, never throws | Yes, automatically, up to the retry cap | No — persisted in the `Email` collection, retried on the next 5s poll |
| **Ollama failure** | AI security analysis / chat-assistant features only | Every core feature — AI is explicitly optional per CLAUDE.md, and `securityAiService.js`'s own circuit breaker (confirmed present, Phase 6 work) already fails toward "no analysis, deterministic security continues" | Yes — verified by reading the code, not re-tested this phase (Ollama isn't running in this dev environment) | Yes — circuit breaker cooldown (60s) auto-retries | No |
| **Network interruption (client-side)** | The client's active connection | Server-side state — nothing server-side breaks from a client disconnecting | Yes | Yes — client reconnect/resync logic (Phase 7-era work, unchanged) | No — messages already sent are durable in Mongo |

## 13. Backup/restore results

**mongodump/mongorestore are not installed on this dev machine**
(MongoDB Database Tools is a separate download from MongoDB Server, not
bundled). Rather than skip this section or install new tooling
unprompted, the same backup→wipe→restore *semantics* were proven directly
via the MongoDB Node driver:

1. **Backup**: every collection in a real local database (3007 users, 2517
   rooms, 6201 messages, 1479 security events, 66 sessions — real data
   from this phase's own load tests) dumped to disk using **BSON Extended
   JSON (EJSON)**, not plain `JSON.stringify`.
2. **Simulated total loss**: `db.dropDatabase()` — confirmed 0 collections
   remained.
3. **Restore**: every collection reloaded from the EJSON dump files.
4. **Verify**: all 5 non-empty collection counts matched exactly
   (3007/3007, 2517/2517, 6201/6201, 1479/1479, 66/66); a real document was
   confirmed byte-identical after the round-trip, including its `ObjectId`
   and `Date` fields preserved as real BSON types (not degraded to
   strings).

**A real, documented finding from this test**: a first attempt using
plain `JSON.stringify`/`JSON.parse` (not EJSON) silently converted every
`ObjectId` into a plain string on restore — the data was still *readable*
and content-correct, but no longer the right BSON type, which would break
every `ref`/`populate()` lookup in the real app (Mongoose queries by
ObjectId, not by the string that happens to look the same). This is
concrete proof of why a real backup strategy must use `mongodump`/
`mongorestore` (BSON-native) or MongoDB Atlas's own snapshot feature —
**never a naive JSON export** — documented here specifically because it's
an easy mistake to make and this test caught it empirically, not just by
citing documentation.

**RPO/RTO — stated honestly, not invented**: MongoDB Atlas's free tier
does **not** include automated continuous backups (that's an Atlas paid
tier feature) — confirmed by this being a documented Atlas limitation, not
something this codebase configures. **Actual RPO today is manual and
unbounded** — there is no automated backup schedule running anywhere for
the real production database. **Actual RTO today is also unmeasured** —
no real production restore has ever been performed (only this local
substitute test). This is a real, honest gap, not glossed over: **Phase
8's recommended next step (§17) is standing up a real, scheduled
`mongodump` (or upgrading to an Atlas tier with continuous backup) — this
phase proved the restore *mechanism* works, not that a backup *schedule*
exists.**

## 14. Actual infrastructure limits

Confirmed free-tier limits, read from each provider's current published
documentation (not assumed from memory) — a full quota-exhaustion table:

| Service | Free-tier limit | What happens at the limit |
|---|---|---|
| MongoDB Atlas (M0) | 512MB storage, shared RAM/vCPU, 500 max connections | Writes start failing once storage is full; the app's existing `/health/ready` would correctly report `degraded`/`db: unreachable` if connections are exhausted — not tested against a real exhaustion event this phase |
| Upstash Redis (free) | 10,000 commands/day (as of the plan documented in `infra/redis.md`), 256MB | Commands beyond the daily cap are rejected — this app's Phase 8 fix (§2.1) means that degrades to single-process mode rather than crashing |
| Render (free web service) | Sleeps after 15min idle (mitigated via `cron-job.org` keep-alive ping per D-011), 750 free instance-hours/month | Sleep = a real cold-start latency hit on the next request, not a data-loss event; instance-hours exhaustion would stop the service entirely until the next billing cycle |
| Cloudflare Pages (free) | 500 builds/month, unlimited bandwidth/requests | Build limit blocks new deploys, not the live site |
| Cloudflare R2 (free) | 10GB storage, 1M Class A + 10M Class B ops/month | Uploads would start failing past storage cap — the app's presigned-URL flow (never proxying through Node, confirmed in `PHASE8-BASELINE.md`) means this fails at the R2 layer directly, cleanly, not as an app crash |
| Brevo (free SMTP) | 300 emails/day | The existing `Email` outbox + cron retry (§12) means a day's overflow queues and retries the next day rather than being lost — confirmed by reading the cron poller's own logic, not newly built |
| Ollama (self-hosted, local) | Bound only by host CPU/RAM — no external quota | AI features already fail toward "no analysis" on any provider failure (§11) |

**Does the app fail gracefully at each limit, or corrupt data?** Based on
the code audited this phase: gracefully in every case except the
already-flagged Mongo-outage slow-fail (§2, "documented not built") — no
code path found this phase that would corrupt data on any of these quotas
being hit; every write path either succeeds atomically or fails with an
error, never partially.

## 15. Cost/quota analysis

No new paid services introduced this phase. Every fix reused existing
infrastructure (same Redis clients, same Mongo indexes mechanism, same CI
runner). Net cost impact: **zero** — the ₹0 target from CLAUDE.md remains
intact. The one dependency bump (`mongoose`, `express`) costs nothing;
`npm audit`'s CI step runs on GitHub Actions' existing free minutes.

## 16. Remaining risks

Ranked by real severity, not exhaustively re-listing every "document and
defer" item already covered in Phase 7's own report:

1. **No automated MongoDB backup schedule exists for the real production
   database.** This phase proved the restore mechanism works; it did not
   (and could not, without touching real production data) set up a real
   backup schedule. This is the single highest-priority gap this report
   surfaces.
2. **Mongoose's default server-selection timeout means a slow-fail (~15-
   30s) during a Mongo outage**, not a fast one — real UX impact during
   any real Mongo blip, not fixed this pass (see §2).
3. **`nedb`/`underscore` have no available security fix** — low real risk
   today (in-process ephemeral state only, Mediasoup itself is disabled in
   production), but worth a dedicated migration-to-plain-Maps pass
   eventually (§9 architecture note).
4. **Mediasoup/TURN capacity is entirely unmeasured** — not a regression,
   just never-yet-measured, blocked on the feature being re-enabled
   somewhere that can compile it.
5. **No real multi-instance test was possible** — Render's free tier is
   single-instance; the Redis-adapter code path was verified by reading it
   and by the Redis-outage failure-injection test, not by an actual
   cross-instance message-delivery test with two real server processes.

## 17. Recommended next phase

1. Stand up a real, scheduled MongoDB backup (either a cron'd `mongodump`
   against Atlas, or upgrade to an Atlas tier with continuous backup) —
   the single highest-value item this report found.
2. Bound Mongoose's server-selection timeout for a faster, more honest
   failure signal during a real Mongo outage.
3. If/when Serv00 reopens or another Mediasoup-capable host becomes
   available: the first real Mediasoup capacity test (concurrent calls,
   CPU/RAM/bandwidth under real WebRTC load) — impossible to do
   meaningfully against a disabled feature.
4. A real multi-instance test, once there's a second real backend instance
   to test against (either via a paid Render tier or a self-hosted second
   node) — everything Phase 8 could verify about the Redis-adapter path
   was verified by code reading and single-instance failure injection, not
   an actual two-server message-delivery test.
5. Migrate `nedb`/`nedb-async` (Mediasoup room/peer tracking) to plain
   in-process `Map`s — closes the last unfixable `npm audit` findings, and
   removes two abandoned dependencies for what's fundamentally simple
   process-local state.
