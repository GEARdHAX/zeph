# Phase 8 load-test harness

Plain Node scripts, no autocannon/artillery/k6 dependency — neither was
already installed, and `fetch` + `socket.io-client` (already a
devDependency, used the same way by `test/message-delivered.test.js`)
cover everything these scripts need.

## Why local, isolated infra

`backend/.env`'s `MONGO_URI`/`REDIS_URL` point at real shared free-tier
services (MongoDB Atlas, Upstash Redis). Load testing at 100-1000
concurrent connections against those would burn real quota. Every load
test here runs against a **local, throwaway** Mongo + Redis instead:

```bash
# one-time, or after a machine restart
mongod --dbpath <scratch-dir>/loadtest-mongo-data --port 27018 --bind_ip 127.0.0.1
redis-server --port 6380 --dir <scratch-dir>

# point the backend at them (copy backend/.env, override these 3 lines)
MONGO_URI=mongodb://127.0.0.1:27018/chitcx_loadtest
REDIS_URL=redis://127.0.0.1:6380
PORT=4099
```

Docker wasn't available in the dev environment this was built in — native
`mongod`/`redis-server` binaries were used directly instead (both were
already installed). `docker-compose.yml`'s `mongo`/`redis` services define
the same topology if Docker is available elsewhere; either works.

## Scripts

- **`seed.js <count>`** — creates N users directly via the model layer and
  prints `{tokens, userIds}` as JSON. Used by every other script to get an
  authenticated user pool WITHOUT hammering `POST /api/register`, which is
  correctly rate-limited to 20/15min per source IP (`authLimiter`,
  `src/init.js`) — a load test should measure that limit, not defeat it.
- **`seed-rooms.js <usersJsonFile>`** — creates N DM rooms directly via the
  model layer from a `seed.js` output file. Same reasoning: `POST
  /api/room/create` sits behind `discoveryLimiter` (100/15min/IP), a real
  limit on room CREATION specifically — a different concern from whatever
  the calling script is actually trying to measure.
- **`http-load.js [concurrency] [baseUrl]`** — A) register+login (bounded
  to 8 requests regardless of `concurrency`, since `authLimiter` caps this
  at 20/15min/IP and register+login share the bucket — this bound IS the
  measured number, not a workaround), B) list rooms, C) create/open a DM,
  D) send a message. All of B/C/D run at the full requested concurrency
  against a seeded user pool.
- **`message-only-load.js [concurrency] [baseUrl]`** — isolates message-send
  throughput specifically, with rooms seeded directly (bypassing
  `discoveryLimiter`, which gates room creation, not message sending) so
  the number measured is what `/api/message`'s OWN limiters
  (`messageSendLimit`, 60/min/user; `apiLimiter`, 300/15min/IP fallback)
  actually allow.
- **`socket-load.js [concurrency] [baseUrl]`** — connects N Socket.IO
  clients, authenticates each (measuring connect+auth latency), then sends
  a real HTTP message per connected pair and measures how long the
  recipient socket's `message-in` event takes to arrive — the real
  personal-room delivery path (`store.io.to(userId).emit(...)`,
  `src/routes/message.js`), not a synthetic stand-in.

## Rate limiters you will hit — this is expected, not a bug

Every number these scripts report is bounded by this app's own real,
intentional rate limiters (`src/init.js`) — hitting one mid-test and
seeing 429s IS the measured capacity, not a script failure:

| Limiter | Scope | Routes |
|---|---|---|
| `authLimiter` | 20/15min per IP | `/login`, `/register`, `/auth/*` |
| `discoveryLimiter` | 100/15min per IP | `/room/create`, `/search`, `/friend-requests`, `/group/create`, ... |
| `messageSendLimit` | 60/min per USER | `/message` |
| `apiLimiter` | 300/15min per IP | every other `/api` route (general fallback) |

A single source IP (this test harness) will always exhaust `apiLimiter`
somewhere between 300-500 combined requests within a 15-minute window,
regardless of how high `concurrency` is set — that's a fixed window count,
not a concurrency ceiling. Restart the backend (a fresh process resets the
in-memory limiter state) between runs that need a clean budget, or run at
lower concurrency to observe behavior *below* the ceiling.

## Running higher concurrency levels

```bash
# fresh server each time — resets the in-memory rate limiter state
node index.js &   # with the load-test .env active
node loadtest/http-load.js 10
node loadtest/http-load.js 50
node loadtest/http-load.js 100
node loadtest/socket-load.js 100
node loadtest/message-only-load.js 500
node loadtest/message-only-load.js 1000
```

Real results from these exact scripts are recorded in
`docs/PHASE8-CAPACITY-REPORT.md`.
