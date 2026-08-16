# PROGRESS — Chattr Engineering Execution Plan

Format per task: `[Phase / Milestone / Task] — Date — Status — Verification`

---

## [Phase 1 / Backend Host] — 2026-07-18
Serv00 hit capacity (170,000/170,000 accounts). Render promoted to active backend host. cron-job.org keepalive (ping /healthz every 5min) mitigates Render's 15-min idle sleep. Serv00 remains migration target — check https://www.serv00.com/register/ periodically for open slots. Logged as D-011 in DECISIONS.md.
Status: IN PROGRESS — deploying to Render.

---

## [Phase 1 / Backend Host] — 2026-07-18
Glitch.com shut down project hosting (July 8, 2025). Replaced with Serv00 (always-on, SSH, PM2, no card, can compile Mediasoup native addon). Render added as fallback (sleeps 15min, use cron-job.org keepalive; MEDIASOUP_ENABLED=false required). Created `infra/serv00.md`, `infra/render.md`. Tombstoned `glitch.json`, `infra/glitch.md`. Logged as D-010 in DECISIONS.md.
Status: DONE. Ready to provision.

---

## [Phase 1 / Stack Final] — 2026-07-18
Hard constraint confirmed: NO credit card at any point. Oracle eliminated (requires card for identity). Final stack: Cloudflare Pages (frontend) + Glitch.com (API) + Local Docker (Mediasoup) + Atlas M0 + Upstash + Cloudflare R2 + GitHub Actions. Code change: `MEDIASOUP_ENABLED` env var gates mediasoup loading in `backend/index.js` and `backend/src/init.js`. Created `infra/glitch.md`, `glitch.json` at repo root, updated `infra/mediasoup-host.md`, `infra/cloudflare.md`. Logged as D-009 in DECISIONS.md.
Status: DONE. Beginning provisioning.

---

## [Phase 1 / Infra] — 2026-07-16
Eliminated Fly.io from the stack (not reliably $0). Consolidated backend API + Socket.IO + Mediasoup onto Oracle Always-Free ARM. Added `docker-compose.prod.yml` (production override: no frontend container, Nginx added). Frontend in production = Cloudflare Pages static build. `fly.toml` tombstoned. Logged as D-008 in DECISIONS.md.
Status: DONE. Beginning Oracle instance provisioning.

---

## [Phase 1 / Constraint] — 2026-07-16
Confirmed infrastructure stack as Path A ($0/month). Hetzner removed; Oracle Always-Free ARM is the sole Mediasoup host. Updated `infra/mediasoup-host.md` to Oracle-only with VCN security list + iptables instructions. Logged as D-007 in DECISIONS.md.
Status: DONE.

---

## [Phase 1 / M1.4 / T1.4.1] — 2026-07-16
Created four state-tracking files (PROGRESS.md, DECISIONS.md, NEXT_STEPS.md, CHANGELOG.md) at the repo root.
Status: DONE. Verified: files exist at root level with initial entries.

## [Phase 1 / M1.1 / T1.1.1] — 2026-07-16
Created `docker-compose.yml` with backend, frontend, MongoDB, and Redis services. Includes named volumes, environment variable pass-through, and inter-service networking.
Status: DONE. Verified: file created at repo root with all four services defined.

## [Phase 1 / M1.1 / T1.1.2] — 2026-07-16
Expanded `backend/.env.example` with Redis, Docker-specific vars, and all Phase 1 required variables. Created/updated `frontend/.env.example` with Docker-compatible defaults.
Status: DONE. Verified: both files include all documented variables with inline comments.

## [Phase 1 / M1.1 / T1.1.3] — 2026-07-16
Added `/healthz` endpoint to backend at `backend/src/routes/health.js` and registered it in the router.
Status: DONE. Verified: route file created; `/api/healthz` returns `{ status: "ok" }` with DB connectivity state.

## [Phase 1 / M1.1 / T1.1.4] — 2026-07-16
Wired Docker Compose healthchecks on all four services and added `depends_on` with `condition: service_healthy` ordering.
Status: DONE. Verified: docker-compose.yml healthcheck blocks and dependency ordering present.

## [Phase 1 / M1.1 / T1.1.5] — 2026-07-16
Written `README.dev.md` covering local setup, environment configuration, common commands, and troubleshooting.
Status: DONE. Verified: file exists at repo root with all required sections.

## [Phase 1 / M1.4 / T1.4.2] — 2026-07-16
Created `.github/workflows/ci.yml` running lint + existing tests on every PR and push to main.
Status: DONE. Verified: workflow file created with install, lint, and test steps for both backend and frontend.

## [Phase 1 / M1.4 / T1.4.3] — 2026-07-16
Added `gitleaks` secret-scanning as a CI step in `.github/workflows/ci.yml`.
Status: DONE. Verified: gitleaks scan step runs before the test steps and blocks on detected secrets.

## [Phase 1 / M1.2 — M1.3] — 2026-07-16
Produced infrastructure provisioning documentation and configuration files for Track B (cloud) tasks:
- `fly.toml` — Fly.io backend deployment config
- `infra/cloudflare.md` — Cloudflare DNS, Pages, R2 provisioning guide
- `infra/redis.md` — Upstash Redis provisioning guide
- `infra/mongodb.md` — MongoDB Atlas M0 provisioning guide
- `infra/mediasoup-host.md` — Hetzner/Oracle Mediasoup VM setup guide
- `infra/coturn.conf` — coturn TURN server config template
- `infra/nginx.conf` — Nginx reverse proxy config with gzip, brotli, rate limiting, TLS
Status: DONE (config files + docs produced). Manual provisioning steps documented in each file.
