# Chitcx — Developer Guide

This document covers everything you need to get the full stack running locally for development.
For production deployment, see the files in `infra/`.

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Node.js | 18.x | [nvm](https://github.com/nvm-sh/nvm) / [nvm-windows](https://github.com/coreybutler/nvm-windows) |
| npm | 9.x (bundled with Node 18) | — |
| Docker Desktop | 4.x | https://www.docker.com/products/docker-desktop |
| Git | 2.x | https://git-scm.com |

---

## Quick Start (Docker — recommended)

The fastest path. All services (backend, frontend, MongoDB, Redis) start together.

### 1. Clone and enter the repo
```bash
git clone <your-repo-url>
cd "Clover v2.9.1"
```

### 2. Configure environment files
```bash
# Backend
cp backend/.env.example backend/.env
# Open backend/.env and set at minimum:
#   AUTH_SECRET=<any random string>
#   ROOT_USER_EMAIL=<your email>
#   ROOT_USER_PASSWORD=<your password>
# For WebRTC to work locally, set PUBLIC_IP_ADDRESS to your LAN IP (not 127.0.0.1)

# Frontend
cp frontend/.env.example frontend/.env
# Defaults work out of the box for Docker — no changes needed
```

### 3. Start all services
```bash
docker compose up --build
```

Services start in this order (enforced by healthchecks):
1. MongoDB → 2. Redis → 3. Backend → 4. Frontend

### 4. Open the app
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:4002
- **Health check**: http://localhost:4002/healthz

### 5. Log in
Use the `ROOT_USER_EMAIL` / `ROOT_USER_PASSWORD` credentials you set in `backend/.env`.

---

## Manual Start (without Docker)

Use this if you have local MongoDB and Redis already running, or want faster iteration without container overhead.

### 1. Set the Node version
```bash
nvm use 18
```

### 2. Configure environment files (same as Docker path above)

### 3. Backend
```bash
cd backend
npm install
npm start
```
Backend runs at `http://localhost:4002`.

### 4. Frontend (separate terminal)
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at `http://localhost:5173` with hot-module replacement.

---

## Common Commands

| Command | Where | What it does |
|---------|-------|--------------|
| `docker compose up` | root | Start all services |
| `docker compose up --build` | root | Rebuild images then start |
| `docker compose down` | root | Stop all services |
| `docker compose down -v` | root | Stop and delete all volumes (wipes DB data) |
| `docker compose logs -f backend` | root | Stream backend logs |
| `npm start` | backend/ | Run backend (no Docker) |
| `npm run dev` | frontend/ | Run frontend dev server |
| `npm run format:write` | backend/ or frontend/ | Auto-format with Prettier |
| `npm run lint:fix` | frontend/ | Auto-fix ESLint issues |

---

## WebRTC / Video Calls in Local Dev

Video calls require Mediasoup to know your machine's real IP address (not `127.0.0.1`).

Find your LAN IP:
```bash
# macOS / Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig | findstr "IPv4"
```

Set it in `backend/.env`:
```
PUBLIC_IP_ADDRESS=192.168.1.X   # your actual LAN IP
MAPPED_IP=false
```

Then restart the backend container:
```bash
docker compose restart backend
```

---

## Troubleshooting

### "Database not available" on backend startup
MongoDB is still initializing. The backend retries every 10 seconds. Wait 30 seconds and refresh.

### Backend container unhealthy / restart loop
Check logs: `docker compose logs backend`
Most common causes:
- `AUTH_SECRET` not set in `backend/.env`
- `MONGO_URI` wrong (in Docker it's automatically `mongodb://mongo:27017/clover`)

### Frontend can't connect to backend
Ensure `VITE_BACKEND_URL` in `frontend/.env` matches the backend's actual address.
In Docker it should be `http://localhost:4002`.

### Video/audio not working
- Browsers require HTTPS for camera/microphone access except on `localhost`.
- For testing on `localhost`, Chrome and Firefox allow media access without HTTPS.
- Set `PUBLIC_IP_ADDRESS` to your LAN IP (not 127.0.0.1) in `backend/.env`.

### Port already in use
```bash
# Find what's using the port (Windows)
netstat -ano | findstr :4002

# Find what's using the port (macOS/Linux)
lsof -i :4002
```
Change `PORT` in `backend/.env` if 4002 is already taken, and update `VITE_BACKEND_URL` in `frontend/.env` to match.

### Mediasoup build fails in Docker
The backend Dockerfile installs `python3`, `make`, and `g++` required for mediasoup's native C++ build.
If the build fails, ensure Docker has at least 2 GB RAM available (Docker Desktop → Settings → Resources).

---

## Project Structure

```
/
├── backend/                  # Express API, Socket.IO, Mediasoup SFU
│   ├── src/
│   │   ├── events/           # Socket.IO event handlers
│   │   ├── mediasoup/        # WebRTC SFU logic
│   │   ├── models/           # Mongoose schemas
│   │   ├── routes/           # Express route handlers
│   │   └── utils/            # Shared utilities
│   ├── config.js             # Runtime config (reads .env)
│   ├── index.js              # Server entry point
│   └── Dockerfile
├── frontend/                 # React SPA (Vite)
│   ├── src/
│   │   ├── features/         # Feature modules (Conversation, Meeting, Admin…)
│   │   ├── pages/            # Top-level route pages
│   │   ├── actions/          # Redux actions
│   │   └── reducers/         # Redux reducers
│   └── Dockerfile
├── infra/                    # Production infrastructure config + guides
├── docker-compose.yml        # Local dev stack
├── fly.toml                  # Fly.io deployment config
├── PROGRESS.md               # Task completion log
├── DECISIONS.md              # Architecture decision records
├── NEXT_STEPS.md             # Current next action (always current)
└── CHANGELOG.md              # User-facing change log
```

---

## CI / Quality Gates

Every PR runs:
1. **Secret scan** (gitleaks) — fails if any credentials are detected
2. **Backend**: Prettier format check + tests
3. **Frontend**: Prettier check + ESLint + tests
4. **Docker build smoke test** — confirms both images build without errors

See `.github/workflows/ci.yml` for details.
