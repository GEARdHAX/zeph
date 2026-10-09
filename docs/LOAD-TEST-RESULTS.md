# Load Test Results (2026-10-09)

Local load tests of the current backend, including the Redis token-bucket rate limiter. Scripts live in [`backend/loadtest/`](../backend/loadtest/). These are single-machine measurements, not production capacity.

## Method

- **Server:** one Node process (current code), `NODE_ENV=production`, AI/calls/mail disabled.
- **Data stores:** throwaway local MongoDB and a local Redis 5.0 (Windows build), separate from any real instance.
- **Machine:** one Windows laptop running both the server and the load generator, so they compete for CPU.
- **Pattern:** every test fires all N requests at once (N simultaneous in-flight requests). This is a burst test, not a model of N real users. Reported latency includes queueing behind other in-flight requests.
- **Two passes:**
  1. **Default rate limits**, which shows the limiter's behaviour as deployed.
  2. **Limits raised** (`RATE_LIMIT_*_CAPACITY`) to measure the raw capacity of one process.
- **Each user in message, room and upload tests** is a distinct seeded account, so per-user limits do not interfere.

## Results with limits raised (raw single-process capacity)

All rows completed with 0 errors.

| Area | Simultaneous requests | p50 | p95 | Throughput |
|---|---|---|---|---|
| Message send | 100 | 541 ms | 573 ms | |
| Message send | 300 | 1.32 s | 1.45 s | |
| Message send | 500 | 2.02 s | 2.20 s | |
| Message send | 1,000 | 3.91 s | 4.22 s | ~230 /s |
| Message send | 2,000 | 7.66 s | 8.13 s | ~240 /s |
| List rooms | 300 / 500 | 701 ms / 1.11 s | 710 ms / 1.12 s | |
| Open DM | 300 / 500 | 874 ms / 1.39 s | 917 ms / 1.47 s | |
| Send message (mixed run) | 300 / 500 | 1.09 s / 1.80 s | 1.22 s / 1.93 s | |
| Login | 25 | 505 ms | 771 ms | ~31 /s |
| Login | 50 | 879 ms | 1.49 s | ~32 /s |
| Login | 100 | 1.62 s | 2.94 s | ~33 /s |
| Login | 200 | 3.12 s | 5.89 s | ~32 /s |
| Image upload (proxy path) | 10 | 2.78 s | 3.01 s | 3.3 /s |
| Image upload | 25 | 3.57 s | 4.49 s | 5.5 /s |
| Image upload | 50 | 5.54 s | 5.73 s | 8.5 /s |
| Image upload | 100 | 6.61 s | 10.75 s | 8.8 /s |
| Image upload | 200 | 12.65 s | 22.93 s | 6.7 /s |
| PDF upload (proxy path) | 100 | 1.13 s | 1.49 s | ~60 /s |
| Socket connect + authenticate | 100 | 105 ms | 129 ms | |
| Socket connect + authenticate | 500 | 456 ms | 862 ms | 500 of 500 connected |

Throughput is simultaneous requests divided by wall-clock time while the server was saturated.

## Results with default rate limits (as deployed)

| Scenario | Result |
|---|---|
| 300 simultaneous message sends | all succeeded, p50 1.24 s, p95 1.36 s |
| 500 simultaneous message sends | 40% rejected with 429 (200 of 500) |
| 1,000 simultaneous message sends | 70% rejected with 429 (700 of 1,000) |
| Login | capped by the auth limit per IP, so login capacity from one address is the limiter's, not the server's |

The per-IP general API limit is a fixed budget, not a concurrency limit: roughly 300 requests are allowed regardless of how many are fired at once. The 429 responses are the limiter working as designed.

## What these do not show

- **Not production capacity** and not a user count. "Simultaneous requests" are not "users".
- **Upload tests used the server's proxy route with local-disk storage.** They include authentication, policy checks, content sniffing, image inspection and thumbnail generation, but not the direct-to-storage path, where file bytes bypass this server. Test files were tiny (a few KB), so bandwidth was not measured. Image uploads are slower than PDFs because of image processing.
- **Sockets:** 500 simultaneous clients connected. A 1,000-client run and 500-client message delivery failed because the test machine ran out of local ports (client side), so the server's limit above 500 is **unknown**. Delivery latency was measured at 100 clients (p50 about 610 ms in both passes).
- **Calls were not load tested.** Cloudflare Realtime has a monthly participant-minute allowance, calls are capped at four participants, and meaningful call load needs real browsers. See [`CALL-QUALITY-METRICS.md`](CALL-QUALITY-METRICS.md) for the functional measurements that do exist.
- **Single process, single run per row, no variance reported, old Redis build.** Treat the numbers as an order-of-magnitude picture of one Node process.

## Grafana k6 results (2026-10-09)

The same endpoints were re-tested with [Grafana k6](https://k6.io) v2.3.0 (`backend/loadtest/k6/burst.js`), same local setup and raised limits as above. k6 was run in two modes:

- **Steady arrival rate** (`constant-arrival-rate`, 15 s, reusable keep-alive connections). This is the mode used for capacity figures, because it measures the application and not the operating system's connection queue.
- **One-shot burst** (all virtual users fire at the same instant). Results below.

### Steady rate, 15 s per row, all requests counted

| Endpoint | Target rate | Achieved | Failed | p50 | p95 |
|---|---|---|---|---|---|
| Send message | 100 /s | 99.9 /s | 0% | 10 ms | 79 ms |
| Send message | 150 /s | 149.9 /s | 0% | 11 ms | 13 ms |
| Send message | 200 /s | 175 /s (116 iterations dropped) | 0% | 1.37 s | 2.59 s |
| Send message | 300 /s | 219 /s | 0% | 2.45 s | 3.15 s |
| List rooms | 100 /s | 100 /s | 0% | 8 ms | 10 ms |
| List rooms | 300 /s | 242 /s | 0% | 1.95 s | 2.46 s |
| Login | 20 /s | 22 /s | 0% | 46 ms | 209 ms |
| Login | 30 /s | 31 /s | 0% | 76 ms | 203 ms |
| Login | 40 /s | 33 /s | 0% | 1.44 s | 2.93 s |
| Image upload (proxy path) | 5 /s | 4.8 /s | 0% | 918 ms | 1.28 s |
| Image upload | 15 /s | 14.2 /s | 0% | 895 ms | 1.14 s |
| Image upload | 25 /s | 23.6 /s | 0% | 899 ms | 1.10 s |
| Image upload | 40 /s | 37.2 /s | 0% | 891 ms | 1.14 s |

**How to read it:** on this machine one Node process keeps latency flat up to roughly 150 message sends/s and 100 room lists/s, then queues once the target rate exceeds what it can serve (achieved rate stops tracking the target and latency jumps to seconds). Login saturates at about 32/s (Argon2 hashing). Image uploads stayed flat up to 40/s with a ~1 s p50 and no failures; the test image was under 1 KB, so this measures server work, not bandwidth, and the saturation point was not reached.

### Sockets (Socket.IO handshake over k6 WebSockets)

| Test | Result |
|---|---|
| 100 simultaneous connects | 100/100 authenticated, p50 127 ms, p95 184 ms |
| 100 new connections/s for 5 s, held open | 450 connections authenticated, 0 failed checks; connect+auth p50 309 ms, p95 5.5 s |
| 100 new connections/s for 10 s, held open | 696 connections authenticated, 0 failed checks; p50 1.6 s, p95 12.9 s |

Connect+auth latency degrades sharply once hundreds of connections arrive per second while others are held open, even though every started connection authenticated. The cause was not investigated (the load generator shares the machine).

### One-shot bursts (all virtual users at once)

| Test | Result |
|---|---|
| 100 simultaneous message sends | 100% succeeded, p50 682 ms |
| 500 simultaneous message sends | 66% succeeded (168 refused at the TCP level) |
| 1,000 / 2,000 simultaneous message sends | 46% / 31% succeeded |
| 500 simultaneous WebSocket connects | 304 of 500 authenticated |

The failures here were `connect: connection refused` from the operating system: hundreds of brand-new TCP connections in the same instant overflow the listen queue before the application is involved. The earlier Node-script bursts (2,000 simultaneous sends, 0 errors; 500/500 sockets) did not hit this because that HTTP client queues and reuses connections. So "N simultaneous" figures depend heavily on the client; the steady-rate table above is the more meaningful measure. Behind a real proxy or load balancer, connections are multiplexed and this burst pattern is not representative.

## Reproduce

```bash
# throwaway infra (never point these at shared services)
mongod --dbpath <scratch> --port 27018 --bind_ip 127.0.0.1
redis-server --port 6380 --save "" --appendonly no

# backend on :4099 against them; raise limits to measure raw capacity
PORT=4099 MONGO_URI=mongodb://127.0.0.1:27018/zeph_loadtest REDIS_URL=redis://127.0.0.1:6380 \
RATE_LIMIT_REDIS_URL=redis://127.0.0.1:6380 AI_PROVIDER=none CALL_BACKEND=none MAILER_ENABLED=false \
RATE_LIMIT_API_CAPACITY=1000000 RATE_LIMIT_API_REFILL_PER_SECOND=100000 \
RATE_LIMIT_AUTH_CAPACITY=1000000 RATE_LIMIT_AUTH_REFILL_PER_SECOND=100000 \
RATE_LIMIT_DISCOVERY_CAPACITY=1000000 RATE_LIMIT_DISCOVERY_REFILL_PER_SECOND=100000 \
RATE_LIMIT_MESSAGE_SEND_CAPACITY=1000000 RATE_LIMIT_MESSAGE_SEND_REFILL_PER_SECOND=100000 \
node index.js

# in backend/ (same MONGO_URI / REDIS_URL exported)
node loadtest/message-only-load.js 1000
node loadtest/auth-load.js 100
node loadtest/upload-load.js 50 http://127.0.0.1:4099 png
node loadtest/socket-load.js 500
node loadtest/http-load.js 300

# k6 (steady rate; see backend/loadtest/k6/README.md)
k6 run -e SCENARIO=messages -e RATE=150 -e VUS=800 -e ROOMS=rooms.json loadtest/k6/burst.js
```

Check the server is connected to the local ports (not a real database) before running anything, and flush the local Redis between runs.
