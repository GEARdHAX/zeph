# ZEPH eBPF Runtime Security Sensor

An independently-deployable Linux host telemetry sensor. It observes
process execution/exit, outbound TCP connections and flow summaries, and
DNS query metadata via [bpftrace](https://github.com/bpftrace/bpftrace),
normalizes them, and ships them to the ZEPH backend's sensor ingestion API
(`POST /api/security/sensor/events`) for storage as `SecurityEvent`
documents (`sourceSystem: 'ebpf'` for process/connection events,
`sourceSystem: 'network_sensor'` for flow/DNS events).

This is **not** part of `backend/`'s Express app. It is a separate Node.js
process that runs on a separate Linux host and talks to the backend only
over HTTPS, using its own least-privilege credential.

Phase 5 (Network Intelligence) extends this SAME process/credential/
ingestion endpoint rather than standing up a second sensor — see
`docs/PHASE5-NETWORK-INTELLIGENCE.md` (backend repo root) for the full
Phase 5 design; this README covers what actually runs here.

## Infrastructure requirement — read this first

**This sensor requires a real Linux kernel with eBPF support
(`CAP_BPF`/`CAP_SYS_ADMIN`) and a working `bpftrace` install.**

ZEPH's current production backend host, **Render**, is a managed
containerized PaaS that cannot even compile a C++ native addon (see
`infra/render.md`: `MEDIASOUP_ENABLED=false` is required because "Render's
build environment cannot compile Mediasoup's C++ native addon"). A platform
that can't build a native Node addon categorically cannot load eBPF
programs into its kernel — there is no kernel access at all on a shared,
managed PaaS. **This sensor cannot and does not run on Render.**

It must run on a real Linux box you control: a developer's own Linux
machine, a dedicated Linux VPS, or (if it comes back online) the Serv00
host referenced in `DECISIONS.md`. This is a genuine infrastructure gap,
not a bug — the sensor is built to fail loudly and immediately on any host
that can't support it (see "Capability check" below), rather than silently
doing nothing or faking data.

This dev environment (Windows) is also unable to run it — every module here
is unit-tested with the real `bpftrace` subprocess and kernel replaced by
injectable fakes (see `test/`), and functional verification against a real
kernel has not been performed. Treat the `.bt` scripts and the
runner/parsing logic as reviewed-but-not-field-verified until run on an
actual Linux host.

## Architecture

```
scripts/process.bt ─┐
scripts/network.bt ─┼─> bpftraceRunner.js (spawns bpftrace, parses stdout)
scripts/dns.bt     ─┘
                       │
                       v
                  events.js (normalize to the backend's validated shape)
                       │
                       v
                anomalyRules.js (small deterministic counters ->
                                  PROCESS_ANOMALY / NETWORK_ANOMALY)
                       │
                       v
                  buffer.js (bounded, drop-oldest local queue)
                       │
                       v (batched every ZEPH_BATCH_INTERVAL_MS)
               uploader.js (retry + backoff, sensor-credential headers)
                       │
                       v
     ZEPH backend: POST /api/security/sensor/events
                       │
                       v
     services/networkIntel/networkRules.js (backend-side deterministic
     detection: port/host scan, beaconing, exfiltration, threat-intel
     correlation — the sensor above submits raw observations only, this
     is where verdicts are actually computed, per spec section 36)
```

## eBPF hooks actually used

- `tracepoint:sched:sched_process_exec` — process start (`scripts/process.bt`)
- `tracepoint:sched:sched_process_exit` — process end (`scripts/process.bt`)
- `kprobe:tcp_connect` — outbound TCP connection attempt, IPv4 only
  (`scripts/network.bt`)
- `kprobe:tcp_close` — connection teardown; reads the socket's own
  `bytes_acked`/`bytes_received` counters (Phase 5's `NETWORK_FLOW`
  aggregated summary — one event per closed flow, not per packet;
  `scripts/network.bt`)
- `uprobe` on libc's `getaddrinfo` — DNS query metadata (the hostname
  argument the calling process already resolved into its own memory, not
  the wire protocol — Phase 5's `DNS_QUERY`; `scripts/dns.bt`)

Deliberately not implemented:
- **File monitoring** — dropped from scope entirely (no `FILE_ACCESS` event
  type exists anywhere in this codebase). The base Phase 4 spec only asked
  for it "if justified, restricted to explicit paths"; there was no
  concrete path worth the added attack surface and complexity for a
  portfolio-scoped sensor.
- **IPv6** — `network.bt` filters to `AF_INET` only.
- **TLS metadata (SNI/JA3 fingerprinting)** — Phase 5 spec sections 14-15
  explicitly allow this as optional. Deliberately deferred: a real SNI
  capture needs either raw ClientHello packet parsing (borderline DPI
  territory this project's privacy boundary avoids) or an OpenSSL uprobe
  (`SSL_get_servername`-equivalent), which adds real fragility (OpenSSL
  build/symbol-version dependence) on top of an already-unverified bpftrace/
  kernel environment. `NETWORK_TLS_METADATA_ENABLED` exists in
  `backend/.env.example` as a documented placeholder for a future pass;
  setting it `true` today has no effect. Destination correlation for
  TLS traffic still works via plain IP:port (443/8443 etc.), just without a
  hostname.
- **DNS response/NXDOMAIN detection** — `scripts/dns.bt` hooks only the
  QUERY side (`getaddrinfo`'s argument); the matching `uretprobe` that would
  read the return code (0 = success, `EAI_NONAME` = NXDOMAIN, etc.) is not
  implemented this pass — see `dns.bt`'s own comment for why. The
  `dns.nxdomain` field exists in the validated event schema for a future
  pass to populate; this sensor never sets it.
- **HTTP metadata** — spec section 16's own stated preference ("prefer not
  to inspect HTTP payloads at all") is followed literally: nothing here
  inspects HTTP traffic at any level.

## Capability check

On startup, `src/index.js`'s `checkCapabilities()`:
1. Verifies `os.platform() === 'linux'` — throws immediately otherwise.
2. Runs `bpftrace --version` — throws immediately if it's missing or fails.

There is no fallback/mock mode. A host that fails either check gets a
process that exits with a clear error, not a sensor that pretends to work.
The DNS runner (`dns.bt`) is independently gated by
`NETWORK_DNS_ANALYSIS_ENABLED` (default on) — a failure there (e.g. libc at
an unexpected path) is logged like any other runner error and does not take
down process/network observation, since each `.bt` script runs as its own
subprocess.

## Configuration

Copy the `eBPF Runtime Security Sensor` section from
`backend/.env.example` into a `.env` file in this directory (or set real
environment variables) and fill in:

| Var | Meaning |
|---|---|
| `ZEPH_SECURITY_API_URL` | Full URL to the backend's `/api/security/sensor/events` |
| `ZEPH_SENSOR_ID` | This sensor's stable identity — mint via the admin `POST /api/security/sensor/register` endpoint |
| `ZEPH_HOST_ID` | Identifies the host this sensor runs on |
| `ZEPH_SENSOR_CREDENTIAL` | The raw credential returned ONCE by `/sensor/register` |
| `ZEPH_BATCH_SIZE` | Max events per upload batch (default 50) |
| `ZEPH_BATCH_INTERVAL_MS` | How often to flush the buffer (default 5000) |
| `ZEPH_MAX_BUFFER_SIZE` | Bounded local buffer size; oldest events drop once full (default 5000) |
| `ZEPH_EVENT_RATE_LIMIT` | Sensor's own self-throttle, events/sec (default 200) |
| `ZEPH_LOG_LEVEL` | `error`\|`warn`\|`info`\|`debug` |
| `ZEPH_BPFTRACE_PATH` | Override if `bpftrace` isn't on `PATH` |
| `NETWORK_DNS_ANALYSIS_ENABLED` | Whether to run `scripts/dns.bt` at all (default `true`) |
| `NETWORK_SENSOR_LIBC_PATH` | Documents the override mechanism only — **not currently wired** into `dns.bt` (bpftrace resolves a uprobe's target path at parse time, not runtime; see `dns.bt`'s own comment). A non-standard libc location requires editing that file's one hardcoded `uprobe:` line directly. |

## Getting a credential

An admin registers a new sensor from the ZEPH backend (requires an admin
JWT):

```
POST /api/security/sensor/register
{ "sensorId": "prod-vps-1", "hostId": "prod-vps-1.example.com" }
```

The response's `credential` field is shown **exactly once** — store it in
`ZEPH_SENSOR_CREDENTIAL` immediately; it is never retrievable again (only
its hash is stored).

## Running

Requires root or `CAP_BPF`/`CAP_SYS_ADMIN` for `bpftrace` itself (standard
for any eBPF tool):

```
npm install
sudo -E npm start
```

## Privacy boundary

Per the Phase 5 spec's own mandatory boundary — this sensor and the
backend detection engine it feeds:

- **DO** collect: source/destination IP+port, protocol, byte/packet counts,
  connection duration, DNS query domain names, process pid/name.
- **DO NOT** collect: chat message contents, WebRTC audio/video, file
  contents, passwords, auth tokens, cookies, encryption keys, TLS
  plaintext, or any raw packet payload.
- **DO NOT** decrypt TLS or install a MITM certificate.
- **DO NOT** inspect WebRTC media (mediasoup traffic is observed only as
  IP:port:byte-count flow metadata, same as any other connection — never
  demultiplexed or inspected).

This is **Network Intelligence / Flow Analysis**, explicitly not "Deep
Packet Inspection" (spec sections 2/53/70) — every field collected is
listed above; nothing beyond it is read from any packet.

## Security model

- Sensor auth (`x-zeph-sensor-id` / `x-zeph-sensor-credential` headers) is
  a completely separate, least-privilege credential space from ZEPH user/
  admin JWTs — it can never grant DB, admin, or user-session access
  (`backend/src/lib/sensorAuth.js`). Phase 5's network events use this
  exact same credential — no second sensor identity/auth system exists.
- The sensor is treated as an untrusted input source by the backend: only
  an explicit allowlist of observation fields is ever read from a
  submitted event (`backend/src/services/ebpf/sensorEventValidation.js`);
  severity/riskScore/decision/malicious/trusted/policy are computed
  server-side and never trusted from the sensor, even if present in the
  payload. This sensor's own code never sets those fields on any event it
  submits — verdicts (`PORT_SCAN_ANOMALY`, `POSSIBLE_BEACONING`, etc.) are
  computed entirely backend-side, in `backend/src/services/networkIntel/`.
- No automated response of any kind — this sensor only observes and
  reports. It never kills a process, blocks an IP, isolates a host, or
  modifies a firewall rule.

## Testing

```
npm test
```

41 unit tests cover event normalization (process/connection/flow/DNS,
including the IPv4/port decode math), the bounded buffer's drop-oldest
behavior, the anomaly-burst rules, the retryable/non-retryable upload
decision tree, and the bpftrace subprocess runner's line-parsing/error-
handling — all against injected fakes, since no Linux/bpftrace host is
available in this dev environment. Functional testing against a real
kernel and real bpftrace binary is **not yet performed** — do that before
relying on this sensor in any real deployment.

The backend-side Phase 5 detection engine (window counters, baseline,
beacon regularity, threat-intel correlation, port/host-scan/exfiltration
rules) has its own, more extensive test suite in `backend/test/networkIntel*`
and `backend/test/networkRulesIntegration.test.js` — run against a real
Redis instance where available (`describeIfRedis`-gated), covering the
actual rule-firing behavior this sensor's own output ultimately drives.
