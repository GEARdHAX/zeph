# ZEPH Phase 5 — Network Intelligence & Traffic Analysis

> ZEPH Phase 5 performs metadata-level network intelligence and does not
> decrypt TLS, inspect private communication payloads, or inspect WebRTC
> media.

This is **Network Intelligence / Flow Analysis** — Level 1 (flow metadata)
+ Level 2 (protocol/DNS metadata). It is explicitly **not** Deep Packet
Inspection (Level 3); no payload of any kind is ever read.

## Architecture

```
Network Interface
       │
       ▼
Network Sensor (ebpf-sensor/ — extends the Phase 4 sensor process,
                 does NOT stand up a second sensor)
       │  scripts/network.bt  — kprobe:tcp_connect / kprobe:tcp_close
       │  scripts/dns.bt      — uprobe on libc getaddrinfo()
       ▼
Flow Aggregation (one summary event per closed TCP connection, not
                   per packet — network.bt's tcp_close hook)
       │
       ▼
Event Normalization (ebpf-sensor/src/events.js → NETWORK_FLOW / DNS_QUERY,
                       validated against the backend's strict allowlist —
                       backend/src/services/ebpf/sensorEventValidation.js)
       │  same batching/buffer/retry/dedup pipeline Phase 4 already built
       ▼
POST /api/security/sensor/events (SAME endpoint + credential as Phase 4 —
                                    sensorAuth + sensorRateLimit)
       │
       ▼
backend/src/services/networkIntel/networkRules.js
       │  Redis-backed sliding-window counters (windowCounters.js,
       │  dnsCounters.js) → deterministic rules → verdict SecurityEvents
       ▼
Phase 3 Threat Intelligence (ThreatIntelService — same cache/quota/circuit
                               breaker every other phase already uses; the
                               network sensor NEVER calls AbuseIPDB directly)
       │
       ▼
Phase 1 Security Telemetry (SecurityEventService → MongoDB → admin views)
       │
       ▼
Phase 2 Risk Engine (documented, deliberate non-integration — see
                       "Risk Engine Integration" below)
       │
       ▼
Zero Trust
```

## Actual Capabilities

| Capability | Status |
|---|---|
| Flow analysis (TCP connect + aggregated flow summary) | **YES** |
| UDP flow metadata | **NO** — deferred; only TCP hooks implemented this pass (see Deferred Work) |
| DNS metadata (query domain) | **YES** (query side only) |
| DNS response/NXDOMAIN detection | **NO** — deferred, see below |
| TLS metadata (SNI) | **NO** — deferred, see below |
| TLS fingerprinting (JA3-like) | **NO** — not implemented |
| TLS decryption | **NO**, and never will be |
| Payload inspection (any protocol) | **NO**, and never will be |
| WebRTC media inspection | **NO**, and never will be |
| HTTP metadata inspection | **NO** — not implemented |

## Detection Rules (backend/src/services/networkIntel/networkRules.js)

All verdicts are computed **backend-side**, from raw sensor observations —
the sensor never submits a severity/anomaly judgment (spec section 36).

1. **PORT_SCAN_ANOMALY** — one process, ≥`NETWORK_SCAN_THRESHOLD` distinct
   destination ports within `NETWORK_FLOW_WINDOW_MS`.
2. **HOST_SCAN_ANOMALY** — one process, ≥`NETWORK_SCAN_THRESHOLD` distinct
   destination IPs within the same window.
3. **POSSIBLE_BEACONING** — regular-interval (coefficient of variation
   ≤15%, minimum gap 1s to exclude bursts) repeated connections to the SAME
   destination, at least `max(3, NETWORK_BEACON_THRESHOLD)` occurrences.
   Never labeled C2 — regular legitimate polling can look identical.
4. **POSSIBLE_DATA_EXFILTRATION** — cumulative `bytesSent` to one
   non-trusted destination exceeds `NETWORK_EXFIL_THRESHOLD` within the
   window. A heuristic; never claims confirmed data theft.
5. **NETWORK_ANOMALY** (`reason: unusual_destination`) — a destination that
   is neither on the operator-configured trusted list nor a previously-seen
   candidate. Lowest severity of the set; exists as a small signal, not an
   alert on its own.
6. **THREAT_INTEL_NETWORK_MATCH** — a flow's destination IP (or a DNS
   query's domain, honestly a no-op today — see Threat Intelligence below)
   matches a confirmed-malicious ThreatIntelService verdict.
7. **DNS_ANOMALY** — either high distinct-domain query volume or high
   NXDOMAIN volume from one process within the window. Never auto-labeled
   malware from one heuristic alone.

## Event Types

`NETWORK_FLOW`, `DNS_QUERY` (raw sensor observations) — `NETWORK_ANOMALY`,
`PORT_SCAN_ANOMALY`, `HOST_SCAN_ANOMALY`, `POSSIBLE_BEACONING`,
`POSSIBLE_DATA_EXFILTRATION`, `DNS_ANOMALY`, `THREAT_INTEL_NETWORK_MATCH`
(backend-computed verdicts). All registered in
`backend/src/constants/securityEventTypes.js`; all reach `SecurityEvent`
via the same `SecurityEventService.record()` every other phase uses.

## Threat Intelligence Flow

```
NETWORK_FLOW destination IP
   │
   ▼
networkRules.evaluateFlow()
   │  priority = HIGH if a scan/exfil rule already fired for this SAME
   │             flow, else LOW (never spends provider quota on an
   │             ordinary, unremarkable connection)
   ▼
ThreatIntelService.lookup()  ← the ONLY path to the provider; the sensor
   │                            never calls AbuseIPDB directly
   ▼
Redis cache (cache-first, negative caching, same module Phase 3 built)
   │  cache miss + priority ≥ MEDIUM
   ▼
AbuseIPDB (circuit-breaker + quota protected, same as every other phase)
   │
   ▼
malicious === true → THREAT_INTEL_NETWORK_MATCH SecurityEvent
```

**Honest limitation**: AbuseIPDB (this deployment's only real provider) is
IP-only. `DNS_QUERY`'s domain lookup is routed through the exact same
`ThreatIntelService.lookup(domain, { type: 'DOMAIN' })` call — satisfying
"must flow through the centralized service, never call the provider
directly" — but always returns `UNKNOWN` today (`no_provider_for_type`),
since no domain-reputation provider exists. This activates for free the
moment a future phase adds one; zero code changes needed in `networkRules.js`
when that happens.

## Risk Engine Integration (Phase 2)

`PORT_SCAN_ANOMALY`/`HOST_SCAN_ANOMALY`/`POSSIBLE_BEACONING`/
`POSSIBLE_DATA_EXFILTRATION` are **deliberately not folded into per-user
risk scoring** — see `backend/src/services/zeroTrust/riskEngine.js`'s own
comment. These events are host/process-attributed (keyed by
sensorId/hostId/pid), not user-attributed; ZEPH has no user↔host mapping
anywhere in its data model, so correlating a host-level network anomaly
into a specific authenticated user's session risk would be a fabricated
correlation — exactly what this project's own "do not fake it" instruction
rules out. This is the same honest scope decision Phase 4 already made for
`PROCESS_ANOMALY`/`NETWORK_ANOMALY`.

What genuinely **does** reach the risk engine, with zero new code: a
`THREAT_INTEL_NETWORK_MATCH` verdict shares the exact same
`ThreatIntelService` Redis cache the risk engine's existing `MALICIOUS_IP`
factor already queries by IP — if a destination the network sensor flagged
happens to be the same address as a user's own request IP, that cached
verdict is picked up automatically through the shared cache.

Cross-signal correlation between Phase 4/5's own host-level events (spec
section 25's "PROCESS_ANOMALY + NETWORK_ANOMALY + MALICIOUS_IP → stronger
risk signal") lives entirely inside `networkRules.js` itself: a flow that
already tripped a scan/exfil rule gets its OWN threat-intel lookup escalated
from LOW to HIGH priority — genuine correlation computed where the real
host-level context exists, not fabricated at the user layer.

## Privacy Boundary

**Collected**: source/destination IP+port, protocol, byte/packet counts,
connection duration, DNS query domain names, process pid/name, sensor/host
identity.

**Never collected**: chat message contents, WebRTC audio/video, file
contents, passwords, auth tokens, cookies, encryption keys, TLS plaintext,
or any raw packet payload. TLS is never decrypted; no MITM certificate is
ever installed; WebRTC media (mediasoup) is observed only as ordinary
IP:port:byte-count flow metadata, never demultiplexed or inspected.

## Cloudflare Awareness

ZEPH sits behind Cloudflare. Rather than hardcoding Cloudflare's published
IP ranges (they rotate, and duplicating Cloudflare's own list is
unjustified scope), Cloudflare addresses are treated as ordinary entries an
operator adds to `NETWORK_BASELINE_TRUSTED` — the same mechanism used for
MongoDB/Redis/Brevo/R2 (spec section 41's own grouping). A deployment that
configures this correctly avoids false `THREAT_INTEL_NETWORK_MATCH`/
`UNUSUAL_DESTINATION` noise for its own edge/proxy infrastructure.

## Private IPs

Reuses `backend/src/services/threatIntel/indicators.js`'s existing
`isPrivateOrReservedIp` (RFC1918, loopback, link-local, IPv6 equivalents) —
already covers correct IPv4/IPv6 validation via the `validator` package
(spec section 37's "do not implement simplistic regex-only validation").
Private/reserved destinations never reach the external provider; the
`ThreatIntelService` returns a clean `UNKNOWN` verdict locally.

## WebRTC / mediasoup

Not specially exempted or specially targeted — mediasoup's UDP media
streams are observed as ordinary flow metadata (if/when UDP flow tracking
is added — see Deferred Work) exactly like any other connection. No rule
in `networkRules.js` treats "UDP" or "high bandwidth" alone as suspicious;
the port/host-scan/beacon/exfil rules key on distinct-destination and
regularity/volume patterns that normal, single-destination, long-lived
WebRTC media traffic does not match.

## Baseline & Poisoning Protection

Two separate mechanisms, never merged automatically (spec section 23):
- **Trusted** — operator-configured only (`NETWORK_BASELINE_TRUSTED`),
  never written to at runtime.
- **Candidate** — a destination seen once is recorded (Redis, 30-day TTL)
  so a second sighting is no longer "brand new," without ever becoming
  silently trusted. Promotion to Trusted is a manual config change, not an
  automated API in this pass.

## Configuration

See `backend/.env.example`'s "Network Intelligence" section for the full
list (`NETWORK_SENSOR_ENABLED`, `NETWORK_FLOW_WINDOW_MS`,
`NETWORK_SCAN_THRESHOLD`, `NETWORK_BEACON_THRESHOLD`,
`NETWORK_EXFIL_THRESHOLD`, `NETWORK_BASELINE_TRUSTED`, etc.) and
`ebpf-sensor/README.md` for the sensor-process-side variables.

## Files

**Created**:
- `backend/src/services/networkIntel/` — `flowIdentity.js`, `cache.js`,
  `windowCounters.js`, `dnsCounters.js`, `baseline.js`,
  `beaconDetection.js`, `networkRules.js`
- `backend/src/routes/security/network-summary.js`
- `ebpf-sensor/scripts/dns.bt`
- `frontend/src/actions/networkIntel.js`
- `frontend/src/features/Admin/NetworkIntelligence.jsx` (+ test)
- `backend/test/networkIntel*.test.js`, `networkRulesIntegration.test.js`,
  `networkSummaryApi.test.js`
- This document.

**Modified**:
- `backend/src/constants/securityEventTypes.js` — Phase 5 event types.
- `backend/src/services/ebpf/sensorEventValidation.js` — `NETWORK_FLOW`/
  `DNS_QUERY` allowlist entries + `sanitizeFlow`/`sanitizeDns`.
- `backend/src/routes/security/sensor-events.js` — type-derived
  `sourceSystem`, network-rules evaluation hook.
- `backend/src/services/threatIntel/securityEventEnrichment.js` — comment
  documenting why `NETWORK_FLOW`/`DNS_QUERY` are NOT added to the generic
  enrichment table (networkRules.js is the dedicated integration point).
- `backend/src/services/zeroTrust/riskEngine.js` — comment documenting the
  deliberate non-integration (see Risk Engine Integration above).
- `backend/src/routes/index.js` — mounts `GET /api/security/network/summary`.
- `backend/config.js`, `backend/.env.example` — Phase 5 config.
- `ebpf-sensor/scripts/network.bt` — added `tcp_close` flow-summary hook.
- `ebpf-sensor/src/events.js`, `config.js`, `index.js` — flow/DNS
  normalization, DNS runner wiring.
- `ebpf-sensor/README.md` — full Phase 5 documentation.
- `frontend/src/features/Admin/index.jsx`, `pages/Home/index.jsx` — nav +
  route for the new admin page.

**Deleted**: none.

## Deployment

- **Linux requirement**: same as Phase 4 — `CAP_BPF`/`CAP_SYS_ADMIN`,
  working `bpftrace`. The DNS uprobe additionally requires the target
  libc to exist at the hardcoded path in `scripts/dns.bt`
  (`/lib/x86_64-linux-gnu/libc.so.6`, Debian/Ubuntu's standard location).
- **Network access**: outbound HTTPS to the ZEPH backend's sensor
  ingestion endpoint; no inbound listener needed.
- **eBPF requirement**: identical to Phase 4 — kernel eBPF support.
- **Serv00 support**: unverified either way — Serv00 registration has been
  closed since before this phase began (see Phase 4's own findings); no
  new information available this pass.
- **Render support**: confirmed **NO** — same finding as Phase 4 (managed
  PaaS, cannot compile native addons, no kernel access).
- **Separate security host required**: **YES**, same as Phase 4 — this
  sensor cannot run inside ZEPH's current production backend process.
- **Required privileges**: root or `CAP_BPF`/`CAP_SYS_ADMIN` for the
  sensor process itself (standard for any eBPF tool); the backend
  detection engine requires no elevated privileges at all — it's ordinary
  application code.

## Performance

Measured via `backend/scratchpad-loadtest.js` — 10,000 simulated
`NETWORK_FLOW` events, sent as 20 batches of 500 (the configured
`MAX_EVENTS_PER_BATCH`), through the real HTTP ingestion endpoint
(`POST /api/security/sensor/events`) against an in-memory Mongo instance
and the real Upstash Redis instance available in this dev environment
(`.env`'s `REDIS_URL`) — two runs, isolating the dedup/rules-evaluation
cost:

**Run 1 — no Redis** (this test suite's default isolation posture,
`helpers/app.js` forces `redisUrl: null`):
- 13,661 events/sec HTTP ingestion throughput.
- All 10,000 events reported as "duplicates" and none persisted — this is
  the documented, correct fail-safe behavior of `sensorEventDedup.js`
  with no Redis (`claimEventOnce` returns `false`/"treat as duplicate" for
  every event rather than risk double-processing — see that module's own
  comment). Confirms the HTTP/validation layer alone, with the rules
  engine and Mongo writes never actually triggered, is not a bottleneck.
- Heap growth: +5.8MB to +7.8MB across two sub-runs — no unbounded growth.

**Run 2 — real Redis, full pipeline active** (dedup + window counters +
DNS counters + baseline candidate tracking + per-flow threat-intel cache
checks + rule evaluation + resulting SecurityEvent writes, all genuinely
executing):
- **10,000/10,000 events accepted** (0 duplicates, 0 rejected).
- **17 events/sec** end-to-end throughput — this is the batch-response
  round-trip rate; the fire-and-forget rule evaluation/Mongo writes
  triggered by each event continue after the HTTP response returns, so
  this number reflects request/Redis-round-trip latency, not a hard
  ceiling on how fast events can be absorbed.
- **27,963 total `SecurityEvent` documents produced** from the 10,000 raw
  flows — the test data's intentionally clustered shape (20 distinct pids,
  250 distinct destination IPs, cycling) genuinely triggered real
  `PORT_SCAN_ANOMALY`/`HOST_SCAN_ANOMALY`/`POSSIBLE_BEACONING` verdicts
  from the detection engine, not just the 10,000 raw observations — a
  concrete signal the rules fire correctly under realistic-shaped load,
  not merely in isolated unit tests.
- **Heap essentially flat**: −0.5MB across the full run (well within GC
  noise) — no memory growth observed even under sustained real load with
  every subsystem active.

No sensor-side (bpftrace) performance numbers are reported — this dev
environment cannot run bpftrace at all (see `ebpf-sensor/README.md`), so
any such number would be invented, which this project's own instructions
explicitly forbid.

## False Positives

Tested scenarios (`backend/test/networkRulesIntegration.test.js`'s
`describeIfRedis` suite, run against real Redis):
- A single ordinary flow to any destination (including a known-malicious
  mock IP) never trips any anomaly rule — thresholds require sustained
  volume/regularity, not a single connection.
- A trusted destination (configured via `NETWORK_BASELINE_TRUSTED`) never
  trips `POSSIBLE_DATA_EXFILTRATION` or `NETWORK_ANOMALY`
  (unusual-destination) regardless of transfer volume.
- Regular-interval connections with realistic jitter (a few seconds of
  variance on a ~60s interval) still register as beacon-shaped (intentional
  — this is what the coefficient-of-variation tolerance is for); a true
  burst (sub-second gaps) is explicitly excluded by `MIN_MEAN_GAP_MS`.

No live WebRTC/MongoDB/Redis/Cloudflare/R2/SMTP traffic was tested against
these rules (no functional sensor deployment in this pass — see
Infrastructure/Deployment above). This is a real, stated limitation: the
detection logic's unit/integration-level correctness is verified; its
behavior against ZEPH's actual live traffic mix is not.

## Tests

- Existing tests before this phase: 819 backend / 463 frontend / 39 `ebpf-sensor`
  (the last fully-verified baseline from Phase 4).
- New this phase: 9 backend test files (`networkIntelFlowIdentity`,
  `networkIntelValidation`, `networkIntelBeaconDetection`,
  `networkIntelBaseline`, `networkIntelWindowCounters`,
  `networkIntelDnsCounters`, `networkRulesIntegration`,
  `networkSummaryApi`, plus extensions to `sensorEventsApi.test.js`), 2
  new `ebpf-sensor` event-normalization tests, 1 new frontend page + test
  file (`NetworkIntelligence.jsx`/`.test.jsx`).
- One real bug caught by the new tests and fixed during this phase:
  `beaconDetection.js`'s regularity check initially treated a burst of
  near-simultaneous connections (sub-millisecond gaps) as "perfectly
  regular" (coefficient of variation of 0) — fixed by adding
  `MIN_MEAN_GAP_MS`, a floor below which gaps are a burst, not a beacon
  interval, regardless of how uniform they are.
- One flaky test found and fixed during this phase (not a product bug):
  `networkIntelBaseline.test.js`'s Redis-backed candidate test used a
  small-range random IPv4 octet as its test key; against the real shared
  Redis instance available in this dev environment, a prior run's 10,000-
  event load test had already populated 30-day-TTL candidates across that
  exact range, causing a genuine, reproducible collision. Fixed by using a
  timestamp+random composite key, unique per test run.
- Backend total after this phase: **900/900 passing** (84 suites).
- Frontend total after this phase: **466/466 passing** (55 files).
- `ebpf-sensor` total: **41/41 passing** (7 suites).
- Load test: 10,000 simulated `NETWORK_FLOW` events — see Performance above.
- Failure-mode tests: no-Redis fail-safe behavior for window counters, DNS
  counters, and baseline candidates (all fail toward "no signal"/"treat as
  new," never toward false alarms) — covered directly in each module's
  own unit test file.
- Security tests: sensor cannot submit a backend-computed verdict type,
  sensor credentials cannot reach any admin-only route (register/status/
  network-summary), a normal user JWT cannot submit sensor events, sensor
  credentials are never logged even on a rejected batch, sensor-provided
  riskScore/malicious/decision/trusted/policy fields are never persisted.

## Deferred Work

- **Phase 6 — AI Risk Engine**: this phase deliberately produces
  structured, deterministic features (flow/DNS metadata, rule verdicts)
  without any AI/ML involvement, exactly as instructed — ready for a
  future AI layer to consume, never bypassing it into a cloud provider
  directly.
- **Phase 7 — Automated Response**: no automatic blocking, process
  termination, firewall modification, or account action of any kind exists
  anywhere in this phase.
- **Phase 8 — Security Command Center**: the admin UI added
  (`NetworkIntelligence.jsx`) is deliberately minimal (recent alerts, top
  suspicious destinations, counts by type) — not a full command center.
- **Phase 9 — Production Hardening**: functional verification against a
  real Linux/bpftrace host, UDP flow tracking, DNS response/NXDOMAIN
  detection (uretprobe), TLS SNI metadata (OpenSSL uprobe), and IPv6
  outbound-connection tracking are all real, honestly-scoped gaps for a
  future pass — not silently dropped, each documented at its own decision
  point in code comments and this document.
