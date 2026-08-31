# ZEPH Phase 8 — Baseline Report

Read before any Phase 8 code changed, per the spec's own "do not assume
Phase 7 results" instruction. Every number here is either read directly
from the repository/`DECISIONS.md` or measured fresh — nothing carried
forward from memory.

## What Phase 7 actually measured (and didn't)

`docs/PHASE7-COMPLETION-REPORT.md` §11 states explicitly: **no load
testing was performed in Phase 7.** Phase 7 built reliability/observability
groundwork (graceful shutdown, `/health/live` vs `/health/ready` split,
Mediasoup resource-leak fix, message-send rate limiting) but recorded zero
throughput, latency, or concurrent-connection numbers. There is no Phase 7
baseline to compare against for capacity — Phase 8 is the first phase to
actually measure any of this.

Test baseline Phase 7 left behind, reconfirmed by running the suites
before starting Phase 8: **1028 → 1075 backend tests, 473 frontend tests**
(Phase 7's own delta), all passing except the one pre-existing
parallel-Jest-worker flake documented in every phase since it first
appeared (`securityAiResourceExhaustion.test.js`, confirmed clean in
isolation every time it's been checked).

## Real deployed infrastructure (not aspirational)

Per `DECISIONS.md` D-011/D-008/D-010, confirmed still current:

- **Backend**: Render free tier (single process, sleeps after 15min idle
  without the cron-job.org keep-alive ping). Serv00 remains the documented
  migration target but has been closed to new registrations since July
  2026 (170,000/170,000 accounts) — no ETA on reopening.
- **Mediasoup**: disabled in production (`MEDIASOUP_ENABLED` unset on
  Render — it lacks the native build toolchain). Every Mediasoup code path
  audited/fixed in Phase 7 and measured in Phase 8 is real, correct code
  that is not currently reachable in production.
- **coturn**: never deployed. `infra/coturn.conf` is a template, not a
  running service.
- **MongoDB**: Atlas free tier (shared cluster).
- **Redis**: Upstash free tier.
- **Frontend**: Cloudflare Pages.
- **Media**: Cloudflare R2, direct browser-to-R2 presigned upload (verified
  in code — `upload-media-presign.js` issues a signed PUT URL,
  `upload-media-complete.js` confirms after the browser's own PUT, no
  binary ever transits the Node process).

**This means Phase 8's spec (multi-instance failover, 1000-5000 concurrent
production users, real DR restore, TURN-under-NAT testing) cannot be
executed against real production infrastructure.** The user confirmed
(2026-08-31) the scope for this phase: run everything genuinely testable
against local, isolated infra and honest single-instance measurement; for
sections assuming a fleet/real DR/TURN, document the design and exact
runbook steps, explicitly labeled as not executable on current
infrastructure rather than faked.

## Load-test infrastructure used

Real MongoDB Atlas/Upstash Redis credentials live in `backend/.env` — load
testing at 100-1000 concurrent connections against those would consume
real quota on shared free-tier services. Every Phase 8 load test instead
ran against a **local, throwaway** Mongo (`mongod --port 27018`) + Redis
(`redis-server --port 6380`), using the native Windows binaries already
installed on this dev machine (Docker was not available in this
environment; `docker-compose.yml`'s existing `mongo`/`redis` services
define the same topology for anyone running this elsewhere). See
`backend/loadtest/README.md`.

## Architecture confirmed unchanged from Phase 7

- Personal-room-per-user Socket.IO delivery model (never per-chat-room
  joins) — `store.io.to(userId).emit(...)`.
- `@socket.io/redis-adapter` for cross-instance delivery — currently only
  meaningful if Render is ever scaled to >1 instance, which it is not
  today (confirmed: Render free tier is single-instance).
- 9 independent `ioredis` clients, one per concern (established Phase 1-6
  convention, unchanged).
- MongoDB is the sole durable source of truth; Redis is cache/pub-sub/
  coordination only — this is the exact CLAUDE.md-mandated posture, and
  Phase 8's failure-injection testing (see the capacity report) is what
  actually proved it holds under a real Redis outage, not just by design
  intent.

## Starting point for capacity work

No prior HTTP throughput, Socket.IO connection capacity, MongoDB query
performance, or Mediasoup capacity numbers exist anywhere in this
repository's history. Every number in
`docs/PHASE8-CAPACITY-REPORT.md` is the FIRST measurement taken, not a
delta from a previous phase.
