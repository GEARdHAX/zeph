# ZEPH Phase 8 — Disaster Recovery, Hosting Failover & Operations Runbook

Documentation-only sections of the Phase 8 spec (§13 TURN, §27-29 backup/
DR/hosting failover, §34 feature flags) — real runbook content and honest
gap-flagging, not aspirational claims. See
[`PHASE8-CAPACITY-REPORT.md`](./PHASE8-CAPACITY-REPORT.md) for everything
that was actually load-tested/measured.

---

## Disaster recovery runbook

**Trigger**: Render (the active backend host, per `DECISIONS.md` D-011)
becomes unavailable — instance crash-loops, account issue, or a Render
platform outage.

```
Primary backend (Render) unavailable
    ↓
1. Confirm it's actually down, not just asleep
   → Render free tier sleeps after 15min idle; the cron-job.org keep-alive
     ping (D-011) should prevent this, but confirm via Render's dashboard
     before treating this as a real outage.
    ↓
2. Provision a fallback backend host
   → infra/serv00.md is the documented migration target IF a slot has
     opened (check https://www.serv00.com/register/ — no email alerts
     exist for this, must be checked manually). If not, a second Render
     free-tier service, or any Node 18-capable host, works as a stopgap.
    ↓
3. Configure environment on the new host
   → Copy backend/.env.example, fill every MAILER_*/MONGO_*/REDIS_*/
     AUTH_SECRET/CORS_ORIGIN value from the real production secrets store
     (never committed — pull from wherever they're actually kept, e.g. a
     password manager or Render's own environment variable dashboard,
     which is the only place they currently live outside a local machine).
    ↓
4. Connect MongoDB
   → Same MONGO_URI (Atlas is host-independent — no data migration
     needed, the new backend just points at the same cluster).
    ↓
5. Connect Redis
   → Same REDIS_URL (Upstash is likewise host-independent). If Redis is
     ALSO down (unlikely — separate provider), the app degrades to
     single-process mode per the Phase 8 fix (§2.1 of the capacity
     report) rather than failing to start.
    ↓
6. Configure Cloudflare
   → Update the `api` DNS CNAME (or A record) to point at the new host's
     address. This is a MANUAL DNS change — see "Automatic vs manual
     recovery" below, this step has no automation today.
    ↓
7. Start the API
   → `npm ci && npm start` (or the Dockerfile, if the new host runs
     containers) — MEDIASOUP_ENABLED should stay unset/false unless the
     new host can compile the native addon (same constraint as Render).
    ↓
8. Verify health
   → curl https://<new-host>/health/live  (expect 200, always)
   → curl https://<new-host>/health/ready (expect 200 once Mongo/Redis
     both connect — Phase 7's health-split work exists exactly for this
     verification step)
    ↓
9. Verify Socket.IO
   → Open the real frontend (Cloudflare Pages, unaffected by a backend
     host change) and confirm a live connection + a real message send/
     receive round-trip.
    ↓
10. Verify media
    → Confirm an image/file upload completes (browser → R2 directly, the
      backend host only issues the presigned URL — a backend outage never
      affects already-uploaded media, only new uploads' authorization step).
    ↓
11. Restore normal operation
    → Update DNS TTL back to normal if it was lowered for the cutover,
      monitor error rates for the next hour.
```

### Automatic vs manual recovery — stated honestly

| Step | Automatic? |
|---|---|
| Render restarting a crashed process | **Automatic** — Render's own platform behavior, not app-specific |
| Detecting Render is fully down (not just asleep) | **Manual** — no external uptime monitor is configured today |
| Provisioning a fallback host | **Manual** — no infrastructure-as-code exists for this app; every `infra/*.md` doc is a hand-followed setup guide |
| DNS cutover | **Manual** — Cloudflare DNS is not automated to fail over; no health-check-triggered DNS failover is configured |
| MongoDB/Redis reconnection once the new host starts | **Automatic** — same connection strings, no data migration |
| Socket.IO clients reconnecting to the new host once DNS propagates | **Automatic** on the client side (existing reconnect/resync logic) — but DNS propagation itself is not instant and not app-controlled |

**There is no automatic failover for a full backend-host outage today.**
This is the honest answer the spec explicitly asks for over an inflated
claim — every step above requiring a human is marked as such.

---

## Hosting failover strategy

Per `DECISIONS.md` D-011, the documented topology is:

- **Active**: Render (single free-tier instance).
- **Documented migration target**: Serv00 (always-on, SSH, Mediasoup-
  capable) — closed to new registrations since July 2026, no reopening
  ETA, must be checked manually.
- **Cloudflare**: DNS/CDN/TLS in front of both — unaffected by which
  backend host is active, but the DNS record pointing at whichever host is
  currently live is a **manual** change (see runbook step 6 above).

No automatic multi-region or multi-host failover exists. This is a single
point of failure by design (zero-cost constraint, per CLAUDE.md) — not
hidden, documented here explicitly.

---

## TURN resilience

**coturn has never been deployed** (`infra/coturn.conf` is a template,
confirmed in `PHASE8-BASELINE.md`). The spec's §13 ask (test direct
connectivity / restrictive NAT / UDP blocked / TCP fallback / TURN relay,
verify credentials/expiration/abuse controls/allocation limits) cannot be
executed against a service that doesn't exist. This section documents what
would need to be true before that testing becomes meaningful:

**Prerequisites, in order**:
1. Mediasoup must be enabled in production first (currently disabled —
   Render can't compile the native addon). TURN only matters for WebRTC
   media, which itself isn't reachable today.
2. A coturn instance needs a real deployment target with a static IP and
   open UDP port range (typically 49152-65535) — `infra/coturn.conf`
   documents the config shape but not a hosting decision.
3. Credential generation (`turn-user`/shared-secret or ephemeral
   credentials via a REST API) needs wiring into the Mediasoup transport-
   creation path (`src/mediasoup/index.js`) — not present today (that file
   creates transports with no ICE server configuration beyond STUN,
   confirmed by reading it).
4. Abuse controls (allocation limits, credential expiration) are coturn's
   own configuration surface (`user-quota`, `total-quota`,
   `max-bps`/`bps-capacity` directives) — not yet set in
   `infra/coturn.conf`, which is currently a minimal template.

**Recommended next step**: build this out as its own phase once Mediasoup
is re-enabled somewhere — testing TURN in isolation, disconnected from a
live calling feature, would not produce meaningful capacity numbers.

---

## Feature flags

Per the spec's own instruction ("use existing configuration/feature-flag
mechanisms where available... do not create a complex feature-flag
service"), this app already has exactly that: env-var-driven boolean
gates, audited here rather than replaced.

| Flag | Controls | Default | Where read |
|---|---|---|---|
| `MEDIASOUP_ENABLED` | Whether the WebRTC SFU loads at all | unset (disabled) | `index.js` |
| `AI_PROVIDER` | Chat-assistant AI features (summarize/translate/draft-reply) | `none` (disabled) | `config.js` |
| `AI_SECURITY_ENABLED` | AI security-incident analysis (separate flag from `AI_PROVIDER` — deliberately independent privacy/risk surfaces, per the existing `.env.example` comment) | `false` (disabled) | `config.js` |
| `MAILER_ENABLED` | Outgoing email (password reset, notifications) | depends on env | `config.js` |

Every one of these is already a real, working kill switch — flipping any
of them to `false`/unset and restarting the process fully disables that
feature with no code change. This IS controlled rollout for this app's
actual risk surface (AI, Mediasoup) — a dedicated flag *service*
(LaunchDarkly-style, percentage rollouts, per-user targeting) would be the
over-engineering the spec explicitly warns against for an app this size
with no continuous-deployment pipeline doing gradual rollouts today.

**Not flag-gated, and correctly so**: core chat/auth/messaging — these are
the product, not risky experiments; gating them would just be an extra
layer of indirection with no real rollback benefit over a normal
`git revert` + redeploy.
