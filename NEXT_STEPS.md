# NEXT STEPS

**This file is always rewritten (not appended) to reflect the single immediate next action.**
**Last updated: 2026-07-18 — Serv00 full (170,000/170,000). Render is the active backend host.**

---

## Current Status
Phase 1 code tasks: ✅ complete.
Stack: **$0/month, zero credit card required at any step.**

```
Cloudflare Pages    $0   Frontend (auto-deploy on git push)
Render              $0   Backend API + Socket.IO — ACTIVE (Serv00 full, wait for slots)
  └── Serv00        $0   Future migration when registration reopens (strictly better)
Local Docker        $0   Mediasoup SFU + WebRTC (your machine, Phase 1)
MongoDB Atlas M0    $0   Database (no card)
Upstash Redis       $0   Cache (no card)
Cloudflare R2       $0   File storage 10GB (no card)
Cloudflare DNS      $0   DNS + CDN (no card)
GitHub Actions      $0   CI/CD (no card)
─────────────────────────
Total               $0/month. No card. Ever.
```

---

## ▶ IMMEDIATE NEXT ACTION: Deploy to Render

Serv00 is at capacity (170,000/170,000). Render is the active backend host.
Follow **[`infra/render.md`](infra/render.md)** — 10 minutes, no card.

### Quick summary of Render steps:

**1. Sign up** → https://render.com → GitHub login (no card)

**2. New → Web Service → connect your repo**
- Root directory: `backend`
- Build command: `npm install`
- Start command: `node index.js`
- Instance type: **Free**

**3. Set environment variables** (Render dashboard → Environment tab):
```
NODE_ENV=production
MEDIASOUP_ENABLED=false
PORT=10000
MONGO_URI=mongodb+srv://chitcx:PASS@cluster.mongodb.net/chitcx?retryWrites=true&w=majority
REDIS_URL=rediss://default:TOKEN@HOST.upstash.io:6380
AUTH_SECRET=<run this locally: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
ROOT_USER_USERNAME=admin
ROOT_USER_EMAIL=your@email.com
ROOT_USER_PASSWORD=your-strong-password
ROOT_USER_FIRST_NAME=Admin
ROOT_USER_LAST_NAME=User
MAILER_ENABLED=false
```

> `MEDIASOUP_ENABLED=false` is required — Render cannot compile Mediasoup's C++ native addon.

**4. First deploy:** Render builds and deploys automatically on save. Watch logs in dashboard.

**5. Test:** `curl https://your-service.onrender.com/healthz` → `{"status":"ok","db":"connected"}`

**6. Set up cron-job.org keepalive** (prevents Render's 15-min sleep):
- https://cron-job.org → sign up (email only, no card)
- New cron job → URL: `https://your-service.onrender.com/healthz` → every **5 minutes**
- This keeps Socket.IO connections alive indefinitely

---

## Remaining provisioning steps (do these alongside Render):

### A. MongoDB Atlas M0 (~5 min) — if not done yet
→ https://www.mongodb.com/cloud/atlas (email only, no card)
→ Follow [`infra/mongodb.md`](infra/mongodb.md)

### B. Upstash Redis (~3 min) — if not done yet
→ https://upstash.com (email/GitHub, no card)
→ Follow [`infra/redis.md`](infra/redis.md)

### C. Cloudflare Pages + DNS (~10 min) — if not done yet
→ https://cloudflare.com (email only, no card)
→ Follow [`infra/cloudflare.md`](infra/cloudflare.md)
- Pages: connect GitHub → build `cd frontend && npm install && npm run build`, output `frontend/dist`
- DNS CNAME: `api` → `your-service.onrender.com` (proxied ✅)

### D. Local Mediasoup (~5 min)
→ Follow [`infra/mediasoup-host.md`](infra/mediasoup-host.md)
- Set `PUBLIC_IP_ADDRESS` to your LAN IP in `backend/.env`
- `docker compose up --build` → confirm `Mediasoup SFU enabled` in logs

---

## Monitor Serv00 for future migration
Serv00 is strictly better (always-on, SSH, can run Mediasoup). Check periodically:
- **Forum**: https://forum.serv00.com — watch the Registration category
- **Registration page**: https://www.serv00.com/register/ — "Register account" button becomes active when slots open
- No automated notifications — manual check only
- When slots open: follow [`infra/serv00.md`](infra/serv00.md) and migrate the backend

---

## Phase 1 Acceptance Criteria
- [ ] `docker compose up` locally → all four containers healthy
- [ ] `https://your-service.onrender.com/healthz` → `{"status":"ok","db":"connected"}`
- [ ] `https://chitcx.pages.dev` → frontend loads
- [ ] cron-job.org keepalive active (pings `/healthz` every 5 min)
- [ ] Local WebRTC call works between two browser tabs
- [ ] GitHub Actions CI passes on every push
- [ ] $0 spent, no credit card used

---

## After Phase 1 passes Review Gate (§2)
Signal completion → I expand Phase 2 to milestone/task level.
