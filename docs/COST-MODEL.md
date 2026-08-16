# Cost Model — Chitcx

**Zero recurring cost, zero external cloud billing accounts, no credit card at
any point in the stack.** Not "should stay free" — designed so there is nothing
that can silently start billing.

## The hard constraint

Every service in this stack was chosen against one rule: no credit card, ever,
at signup or later. That rule eliminates an entire category of free-tier that
technically has a $0 option but requires a card on file "for verification" —
those tiers can and do get narrowed or converted to paid without much notice,
and a card on file is the mechanism that makes an accidental bill possible in
the first place. A service that never had a card attached cannot silently start
charging one.

## AWS: excluded by design, not by oversight

The original spec considered AWS SQS/Lambda/CloudWatch for background jobs and
observability, gated on "if the always-free allowance is sufficient." That
framing was rejected, not just deprioritized:

- AWS's historically-free tiers have been narrowed before and can be again —
  building around "should stay free" is a standing risk, not a one-time decision.
- It adds a second cloud billing account to monitor forever, for a capability a
  self-hosted Redis-backed queue already covers locally with zero new
  infrastructure (Redis is already in the stack — see below).
- "Zero external cloud billing accounts, period" is a materially simpler and
  more defensible story than "these specific free tiers are still free as of
  today."

**Where AWS's role went instead:** background job queuing uses BullMQ against
the same Redis instance already provisioned for presence/session state, not a
separate managed queue service.

## The actual $0 stack

| Component | Host | Why this one |
|---|---|---|
| Frontend (static build) | Cloudflare Pages | Free unlimited bandwidth, auto-deploy on push, no card |
| Backend (Express + Socket.IO) | Render free tier | No card; sleeps after 15 min idle, mitigated with a `cron-job.org` keepalive ping every 5 min |
| Backend (upgrade path, not yet active) | Serv00 | Always-on, SSH, no sleep — but registration has been at-capacity; documented as the migration target for when a slot reopens, not relied on today |
| Database | MongoDB Atlas M0 | Free forever, 512MB cap, no card |
| Cache / presence / job queue | Upstash Redis (deployed), Docker Redis (local dev) | Render's free tier sleeping would reset an in-process or co-located Redis's state on every wake cycle — a managed always-available free instance avoids that; Docker Redis stays local-dev-only, matching the existing dual-provider pattern |
| File/media storage | Cloudflare R2 | 10GB free, zero egress fees — matters because Render's free compute has ephemeral/limited disk |
| DNS / TLS | Cloudflare free | Free proxy + TLS termination |
| WebRTC SFU (mediasoup) | Local Docker only | No free host in this stack reliably compiles/runs mediasoup's native addon — an acknowledged, documented gap, not silently dropped |
| AI (optional) | Ollama, self-hosted via Docker (`docker compose --profile ai up`) | No API key, no per-token billing, no cloud dependency at all — the strongest version of "works with zero AI configured" is not depending on a cloud AI provider in the first place |

## Where the $0 constraint directly shaped engineering decisions, not just hosting

**MongoDB Atlas M0 over self-hosted:** a self-hosted Mongo on a free-tier PaaS
host has no durability SLA — losing the one instance loses all data with no
managed backup. Atlas M0's 512MB cap is treated as an intentional, disclosed
ceiling ("here's the limit, here's the migration path off it if this were a
real product") rather than a gap to hide.

**Reconnect/resync work (D-016) is load-bearing because of Render's sleep
behavior, not incidental:** Render's free tier drops every live Socket.IO
connection on each 15-minute-idle sleep/wake cycle, independent of how good the
reconnect protocol is. The missed-message resync route
(`POST /api/messages/sync`) was designed on the explicit assumption that the
backend process itself is not durable — because on this budget, it isn't.

**AI provider abstraction fails closed, not open:** even a generous free-tier
LLM API key can be revoked or rate-limited without notice. The AI service
(`backend/src/ai/`) is built so the entire application functions with zero AI
configured — `AI_PROVIDER=none` is the default, and every AI route returns a
clean `503` rather than the app depending on an external key existing.

## What this rules out, explicitly

Per the original engineering plan's own P4 list, confirmed against the actual
codebase rather than assumed: Kubernetes, microservices, Kafka, blockchain,
unnecessary Elasticsearch, custom cryptography, and AWS as a hard dependency for
anything. None of these were close calls during this work — nothing in the
actual traffic/scale profile of this project justified reconsidering any of
them.
