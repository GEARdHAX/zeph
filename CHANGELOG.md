# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [Unreleased]

### Added
- `docker-compose.yml` — four-service local dev stack (backend, frontend, MongoDB, Redis)
- `backend/src/routes/health.js` — `/healthz` readiness endpoint with DB connectivity check
- `backend/.env.example` — expanded with Redis, Docker, and all Phase 1 required variables documented
- `frontend/.env.example` — updated with Docker-compatible defaults
- `README.dev.md` — developer onboarding guide (local setup, commands, troubleshooting)
- `.github/workflows/ci.yml` — CI pipeline: install, lint, test, gitleaks secret scan
- `fly.toml` — Fly.io backend deployment configuration
- `infra/cloudflare.md` — Cloudflare provisioning guide (DNS, Pages, R2)
- `infra/redis.md` — Upstash Redis provisioning guide
- `infra/mongodb.md` — MongoDB Atlas M0 provisioning guide
- `infra/mediasoup-host.md` — Hetzner/Oracle Mediasoup VM setup guide
- `infra/coturn.conf` — coturn TURN server configuration template
- `infra/nginx.conf` — Nginx reverse proxy config (gzip, brotli, rate limiting, TLS)
- `PROGRESS.md`, `DECISIONS.md`, `NEXT_STEPS.md`, `CHANGELOG.md` — state tracking files

### Changed
- `backend/src/routes/index.js` — added `/healthz` route registration

---

## [2.9.1] — prior baseline
- Initial codebase: Node.js/Express backend, React/Vite frontend, Socket.IO, Mediasoup WebRTC SFU
