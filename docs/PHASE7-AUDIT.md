# ZEPH Phase 7 — Production Hardening Audit

Read-only repository audit performed before any Phase 7 code changes, per
the phase spec's own "verify from code, do not guess" instruction. Every
claim below is cited to an exact file/line, gathered via direct code
reading (4 parallel focused sweeps covering: backend infra/observability;
Socket.IO/realtime delivery; Mediasoup/TURN/R2/MongoDB indexes; frontend
performance).

## 0. Correction to the spec's stated test baseline

The Phase 7 spec states the current baseline is "Backend: 556 tests,
Frontend: 433 tests." That is stale — it predates Phases 4-6 built earlier
in this same engagement. The actual current baseline, verified by running
every suite immediately before starting this audit:

- **Backend: 1,028 tests, 96 suites — all passing.**
- **Frontend: 473 tests, 56 files — all passing.**
- **`ebpf-sensor` (standalone Linux sensor project): 41 tests, 7 suites — all passing.**

Phase 7's "do not reduce the existing test baseline" requirement is
measured against these real numbers, not the spec's stale ones.

## 1. Current Architecture (confirmed, not aspirational)

```
Cloudflare (DNS/CDN/TLS) — real
   │
   ├─ Cloudflare Pages (frontend) — real, per infra docs
   ├─ Cloudflare R2 (media) — real, direct-to-R2 presigned upload path exists
   │
   ▼
Render (ACTIVE production backend host, per D-011 — Serv00 hit its
170,000-account cap and is closed; Render was promoted to primary)
 ┌───────────────────────────────────────────┐
 │ Node.js + Express (single process)         │
 │ Socket.IO (personal-room-per-user model,   │
 │   NOT a per-chat-room join model)          │
 │ Passport JWT auth + Session-based revoke   │
 │ Zero Trust risk engine (Phase 2)           │
 │ Threat Intelligence (Phase 3, AbuseIPDB)   │
 │ eBPF sensor ingestion (Phase 4)            │
 │ Network Intelligence (Phase 5)             │
 │ AI Security Risk Engine (Phase 6, Ollama)  │
 │ BullMQ: group-cleanup, security-ai-analysis│
 │ Mediasoup (ONE worker, ONE router, whole   │
 │   process — gated MEDIASOUP_ENABLED=true,  │
 │   OFF on Render since it can't compile the │
 │   native addon)                            │
 └───────┬─────────────────────────────────────┘
         │
    ┌────┼──────────────────────┐
    ▼    ▼                      ▼
 MongoDB Redis (9 independent  BullMQ (shares the
 Atlas   ioredis clients —     Redis connection
 (source  one per concern,     from queues/connection.js)
 of       none closed on
 truth)   shutdown — see §4)
```

**coturn is NOT deployed** — `infra/coturn.conf` is a template with literal
placeholder secrets (`CHANGE_ME_TO_RANDOM_SECRET`), referenced nowhere in
either `docker-compose.yml` or `docker-compose.prod.yml`, and no ICE/STUN/
TURN server list exists anywhere in the mediasoup client integration.
Calls today have **zero NAT-traversal fallback** beyond mediasoup's own
direct UDP transport IP.

## 2. Current Bottlenecks

1. **Mediasoup is a single worker/router for the entire process** — no
   worker pool, no per-CPU-core scaling, no per-room router
   (`backend/src/mediasoup/index.js:18-33`). All concurrent calls share one
   router. A worker crash exits the **entire backend process** after a 2s
   delay (lines 25-28), taking down chat/API/everything, not just calls.
2. **All rate limiting is single-instance in-memory** — neither
   `express-rate-limit` nor the three hand-rolled limiters
   (`inviteRateLimit.js`, `authCodeRateLimit.js`, `sensorRateLimit.js`) is
   Redis-backed. Horizontal scaling (multiple backend instances) would
   multiply every limiter's effective budget by instance count.
3. **Presence is process-local** (`store.onlineUsers`, `store.sockets` —
   plain in-process `Map`s, `backend/src/init.js:32`) — `broadcastPresence()`
   only reaches sockets on the same process. The Redis Socket.IO adapter
   fixes cross-instance *event delivery* but not this presence computation
   loop, so multi-instance presence would be inconsistent today.
4. **`AuthCode` collection has zero indexes** (`backend/src/models/AuthCode.js`)
   — every login/password-reset code verification
   (`routes/auth/change.js:61,84`) does a full collection scan.

## 3. Security Gaps

1. **`backend/src/events/more-messages.js` and `more-images.js`** — the
   two Socket.IO handlers of these names trust a client-supplied `roomID`
   with **zero membership check**. Any authenticated socket can page
   through any room's message history/images by guessing/enumerating a
   Mongo ObjectId. The HTTP twins of both routes already re-verify
   membership; the socket versions were never given the same fix.
2. **`backend/src/routes/typing.js`** — no membership check on `roomID`
   (any authenticated user can trigger a typing broadcast into any room
   they can guess the id of), and no null-check on `Room.findById` — a
   bad/missing roomID throws on `room.people.forEach`, an unhandled
   rejection rather than a clean 404.
3. **`backend/src/mediasoup/index.js:296,326`** — WebRTC signaling
   broadcast targeting uses `data.roomID || 'general'` (client-supplied),
   same "trust client room identity" anti-pattern as #1, in a different
   subsystem.
4. **No security-headers middleware** (`helmet` or equivalent) — confirmed
   absent from `backend/src/init.js` and `package.json`.
5. **No NoSQL-injection sanitization library** (`express-mongo-sanitize` or
   equivalent) — confirmed absent. Mitigated in practice by routes
   destructuring specific fields rather than spreading `req.fields`
   directly into Mongoose queries (spot-checked `user-edit.js`), but this
   is convention-enforced, not defense-in-depth enforced.
6. **No `maxHttpBufferSize` configured on the Socket.IO server**
   (`backend/index.js:56`) — relies on Socket.IO's 1MB default with no
   additional application-level payload validation on socket handlers.

## 4. Reliability Gaps

1. **No graceful shutdown handler exists at all** — confirmed zero
   `SIGTERM`/`SIGINT` handlers anywhere in `backend/index.js` or
   `backend/src/init.js`. On deploy/restart: none of the 9 independent
   Redis connections are closed, Mongo is never explicitly closed, BullMQ
   workers are killed mid-job rather than drained, the HTTP server is
   never `.close()`d, and Mediasoup workers are never closed.
2. **Mediasoup transport/producer/consumer leak on ungraceful disconnect**
   — there is no handler for the bare Socket.IO `disconnect` event in
   `backend/src/mediasoup/index.js`; only the explicit `leave` event
   cleans up. A dropped connection (network loss, tab close, crash)
   **never closes its transports/producers/consumers** — real UDP
   transports and C++ resources leak on the mediasoup worker until the
   whole process restarts. Additionally, even on a clean `leave`, the
   `producerTransports`/`consumerTransports`/`producers`/`consumers`
   JS-side tracking objects are never delete-keyed (only `.close()`d),
   so those objects grow unboundedly for the life of the process.
3. **No idempotency key on message send** (`backend/src/routes/message.js`,
   `backend/src/models/Message.js`) — no `clientMessageId`/nonce field
   exists anywhere. A network retry, double-tap, or multi-tab resend
   creates duplicate `Message` documents, both delivered via `message-in`.
4. **Orphaned R2 media is never cleaned up** — the only place `Media`
   documents/objects are deleted is `groupCleanupWorker.js`, 24h after a
   **group** is deleted, and only for media referenced by that group's
   messages. An upload that's never attached to a sent message (abandoned
   compose, failed send, closed tab) lives in R2/Mongo forever. DM media is
   never cleaned up under any circumstance, even after message/conversation
   deletion.
5. **`group-cleanup` BullMQ queue has no `removeOnComplete`/`removeOnFail`
   bounds** (unlike `security-ai-analysis`, which bounds both to 24h) —
   completed/failed job records accumulate in Redis indefinitely.
6. **Two competing `pino-http` instances** — `backend/index.js:14-17`
   (autoLogging ON) and `backend/src/init.js:166` (autoLogging OFF, added
   later per its own comment claiming pino-http "was never actually wired
   in," which is incorrect — it already was). The second instance
   overwrites `req.id` from the first. Looks like an unintentional
   double-mount, not a deliberate two-stage design.

## 5. Observability Gaps

1. **Zero structured metrics anywhere** — no `prom-client`, no
   `/metrics` endpoint, no counters/histograms of any kind. All
   observability today is Pino log lines (`logger.info`/`logger.warn`)
   only — confirmed via exhaustive grep for `prom-client`, `StatsD`,
   `OpenTelemetry`, `prometheus` across `backend/src` and `package.json`.
2. **Health check is Mongo-only** (`backend/src/routes/health.js`) — no
   Redis check, no liveness/readiness split (it's mounted 3 times, always
   the same combined check), no Socket.IO/Mediasoup/queue-depth signal.
3. **CI never exercises real Redis** — `mongodb-memory-server` is used for
   Mongo in CI, but there is no Redis service container in
   `.github/workflows/ci.yml`, so every Redis-dependent code path (queues,
   adapters, caches, rate limiters) only ever runs its "Redis unavailable"
   fallback branch in CI.

## 6. Scalability Risks

1. **Message documents carry unbounded-with-group-size arrays**
   (`readBy`, `deliveredTo`, `deletedFor` on `Message.js:20,25,34`) — each
   grows by one `ObjectId` per room participant per action. Bounded by
   room size (fine for DMs, real growth cost for large groups: every
   message document accumulates up to `groupSize` entries across 3 arrays).
2. **`Meeting.js`'s `peers`/`users` arrays** — `peers` is an untyped
   `Array` (no sub-schema), self-pruned on clean `leave` via `$pull` but
   **never pruned on an ungraceful disconnect** (same root cause as
   reliability gap #2) — long-lived meetings with flaky clients accumulate
   stale entries. `users` uses `$addToSet` so it never duplicates but also
   never shrinks — grows for the life of the document.
3. **Frontend ships one bundle** — no route-level code splitting
   (`React.lazy()`) anywhere in `frontend/src/App.jsx` or
   `frontend/src/pages/Home/index.jsx`; the entire chat app plus all 6
   admin sub-pages (Phase 1-6 admin UIs) load in the initial bundle.
   Component-level lazy-loading already exists as a pattern (media
   viewers/editors) — it was just never extended to routes.
4. **Message list is not virtualized** — `Messages.jsx` renders every
   loaded message's DOM node with no windowing.
   `Message.jsx` (instantiated once per message) has **zero**
   `memo`/`useMemo`/`useCallback`, and the Redux `io` reducer's `messages`
   array is denormalized (full-array replacement/patch on most actions),
   so any single message mutation (read receipt, delivery ack) triggers a
   re-render of every mounted `<Message>` in the room.

## 7. Performance Risks

1. **`moment.js`** still used in 10 files with no lighter alternative
   installed — a known bundle-weight cost, not fixed by this codebase.
2. **Two styling systems co-exist** — `styled-components` (^6.5.3) is
   still a dependency alongside Tailwind CSS v4 + shadcn/ui, despite
   `DECISIONS.md` D-013–D-022 documenting the migration to Tailwind as
   complete. Worth a follow-up dependency audit (out of Phase 7 scope
   unless it's actually still imported anywhere — not verified in this
   pass).
3. **No Vite bundle-chunking config** — default Rollup chunking only,
   no `manualChunks`, though a bundle-size **tracking** script
   (`scripts/bench-bundle.js`) already exists.

## 8. Cost Risks

1. **Unbounded R2 storage growth from orphaned media** (§4.4) — the one
   concrete cost risk found: R2's free tier has a real object-count/storage
   ceiling, and nothing currently prevents unbounded accumulation of
   never-attached uploads.
2. Everything else in the current stack (MongoDB Atlas free tier, Upstash
   Redis free tier, Cloudflare Pages/R2 free tier, self-hosted Ollama,
   Render free/hobby tier) remains within its documented free-tier
   quota per `docs/COST-MODEL.md` and `DECISIONS.md` — no other cost risk
   identified in this audit pass.

## 9. Phase 7 Implementation Plan

Given the scope of section 1's findings and this phase's own "do not
over-engineer" instruction, the plan below is triaged into **fix now**
(real, verified bugs/gaps with a small, safe diff) vs. **document and
defer** (real gaps whose correct fix is either a larger architectural
change than a hardening pass should make unilaterally, or is genuinely
lower priority than the others).

### Fix now

1. Graceful shutdown handler (SIGTERM/SIGINT) — close HTTP server, stop
   accepting new connections, close all 9 Redis clients via their existing
   `close*Connection()` exports, close BullMQ workers, close Mongo, close
   Mediasoup workers if enabled. Bounded timeout, force-exit if exceeded.
2. Split `/health/live` (process-up only, no dependency checks) from
   `/health/ready` (current Mongo-ping logic + a bounded Redis ping) —
   keep `/healthz`/`/api/health` as an alias of `/health/ready` for
   backward compatibility with the existing Docker Compose healthchecks.
3. Fix `more-messages.js`/`more-images.js` socket handlers to re-verify
   room membership server-side, matching the existing HTTP-route pattern.
4. Fix `typing.js` to check membership + null-check `Room.findById`.
5. Fix mediasoup's `disconnect`-vs-`leave` gap: add a `disconnect` handler
   that runs the same cleanup `leave` does, and fix the tracking-object
   leak by actually deleting map/object keys on cleanup, not just calling
   `.close()`.
6. Add `removeOnComplete`/`removeOnFail` bounds to the `group-cleanup`
   queue, matching `security-ai-analysis`'s existing pattern.
7. Add indexes to `AuthCode` (the confirmed collection-scan gap) plus a
   TTL index matching the sibling invite/token models' existing pattern.
8. Remove the duplicate `pino-http` mount; keep exactly one, with
   `autoLogging` on and `/healthz` excluded (the behavior that already
   exists today), so `req.id` has one unambiguous origin.
9. Add `helmet` (a single well-known dependency, not a new architecture)
   for baseline security headers.
10. Add a dedicated, tighter rate limiter for message-send (currently only
    covered by the generic 300/15min fallback).
11. Route-level code splitting via `React.lazy()` for the 6 admin
    sub-pages (Phase 1-6 admin UIs are the least-visited routes and the
    largest single removable chunk from the initial bundle) — leave the
    core chat/Home/Conversation routes eagerly loaded since they're the
    primary path every user hits immediately.
12. Add `React.memo` to `Message.jsx` (the component instantiated once per
    message in an unvirtualized list, currently the one clear win without
    introducing a virtualization dependency this phase's own
    "do not add dependencies merely for optimization" rule would flag).

### Document and defer (real gaps, correct fix is bigger than a hardening-pass diff)

- **Message-send idempotency key** — needs a schema change
  (`clientMessageId` on `Message`) plus client-side changes to generate
  and retry with one; real, but a feature-shaped change, not a pure
  hardening fix. Documented as a known gap with a recommended design.
- **Orphaned R2 media cleanup** — needs a new scheduled job (BullMQ
  repeatable job scanning for `Media` documents older than N hours with no
  referencing `Message`) — buildable, but sized as its own unit; included
  if time permits, otherwise documented with the exact design.
- **Redis-backed rate limiting** — the existing in-memory limiters are a
  known, explicitly-commented `ponytail:` tradeoff already in the
  codebase for single-instance deployment (which Render currently is).
  Not converting to Redis-backed limiters this pass — no concrete
  multi-instance requirement exists yet (Render is single-instance), and
  the spec's own instruction is "Redis-backed distributed rate limiting
  **where required**." Documented as the upgrade path for when ZEPH
  actually runs >1 instance.
- **Message-list virtualization** — real finding, but adding a
  virtualization library is exactly the kind of new-dependency-for-
  optimization the spec's own §23 says to avoid "unless profiling
  justifies it." No profiling exists yet. Documented, not implemented.
- **Mediasoup worker pool / per-room router / crash-restart-without-full-
  process-exit** — a real architectural gap, but Mediasoup is disabled in
  the actual current production deployment (Render) per D-011/D-008 — this
  is dead code in production today. Documented, not rebuilt, since
  building out multi-worker mediasoup infrastructure for a feature that
  isn't even reachable in production would be the over-engineering this
  phase is explicitly told to avoid.
- **coturn deployment** — same reasoning: Mediasoup itself isn't live in
  production; deploying and wiring a real TURN server for a currently-
  disabled calling feature is out of scope. Documented as a prerequisite
  for ever re-enabling calls in production.
- **Redis-backed presence** — real gap, but only matters once ZEPH
  actually runs >1 backend instance, which it does not today. Documented.
- **Two styling systems (styled-components + Tailwind)** — needs its own
  audit to confirm what (if anything) still imports styled-components
  before removal; not started this pass, flagged for a follow-up.
