# Distributed Rate Limiting

## 1. Why the old fixed-window MemoryStore was replaced

Before this migration, Zeph had two single-process rate limiters:

- `express-rate-limit` (default `MemoryStore`) for 6 app-level HTTP limiters
  in `src/init.js` (AUTH, API, AI, DISCOVERY, DELETE, VAULT_UNLOCK).
- A hand-rolled in-memory `Map`-based fixed-window limiter
  (`src/lib/inviteRateLimit.js`, now removed) used at 11 call sites in
  `src/routes/index.js` — invites, meeting invites, message send/search,
  report creation, passkey login, and admin-triggered security-AI analysis.

Both stored their counters in process memory. That has two concrete,
already-observed consequences:

1. **Every limit resets on every deploy/restart.** A user who hit a 429
   right before a restart gets a fresh budget immediately after.
2. **N backend instances give N× the intended budget.** Each instance has
   its own independent counter for the same user/IP, with no coordination
   between them — this is the actual blocker for ever running Zeph
   horizontally scaled, independent of the mediasoup/port-exposure problem
   documented elsewhere.

Both limiters' own code comments already flagged this (`ponytail:` notes
in `inviteRateLimit.js`/`sensorRateLimit.js`) as a known, accepted
limitation "for now" — this migration is that follow-up.

## 2. Why a token bucket, not a different fixed-window implementation

A **fixed window** (what `express-rate-limit` and the old `Map` limiter
both did) resets hard at a window boundary. That has two real problems:

- A caller can send 2× the limit right at the boundary — the tail of one
  window plus the head of the next, both within the same limit each.
- A caller who used their full budget early in the window must wait out
  the *entire remaining window*, even if that's much longer than the
  window's own nominal period would suggest.

A **token bucket** refills continuously instead of resetting at a
boundary, which gives a materially different and more predictable
guarantee: a smooth long-run rate, with a bounded burst up to the
bucket's capacity. **This is not equivalent to "the same limit, just
implemented differently"** — do not describe it that way. See §9 for the
exact behavioral difference this produces in testing.

## 3. Algorithm

Each bucket tracks `tokens` (current count) and `lastRefill` (a
timestamp). On each request:

```
elapsedSeconds = (now - lastRefill) / 1000
refilledTokens = min(capacity, tokens + elapsedSeconds * refillRate)

if refilledTokens >= cost:
    remaining = refilledTokens - cost
    ALLOW
else:
    remaining = refilledTokens
    DENY, retryAfterSeconds = ceil((cost - refilledTokens) / refillRate)
```

Tokens never exceed `capacity` and never go negative — both are explicit
invariants enforced in the Lua script (`src/lib/tokenBucket.js`).

## 4. Redis atomicity

The entire algorithm above — read, refill, check, consume, save, set TTL
— runs as **one Redis Lua script** (`EVAL`), not a `GET` followed by a
`SET`. A GET-then-SET implementation has a real race: two concurrent
requests can both read the same pre-consumption token count before either
writes back, both "succeed," and the bucket ends up having allowed one
more request than its capacity should have permitted. The Lua script
closes this because Redis executes the entire script as a single atomic
operation — no other command (including another invocation of the same
script) can interleave with it.

The script uses Redis's own `TIME` command for the current timestamp,
never a client-supplied one. This matters specifically for horizontal
scaling: every backend instance, regardless of its own system clock,
computes refill against the exact same clock, so the bucket's behavior
doesn't depend on inter-instance clock skew.

## 5. Key structure

```
rl:v1:<POLICY_NAME>:<identityType>:<identityValue>
```

Examples:

```
rl:v1:AUTH:ip:203.0.113.4
rl:v1:MESSAGE_SEND:user:64f1a2b3c4d5e6f7a8b9c0d1
rl:v1:INVITE_PREVIEW:ip:198.51.100.7
```

Each bucket is a Redis hash with two fields: `tokens` and `lastRefill`.
TTL is `ceil(capacity / refillRate) + 30` seconds — the time a bucket
would take to fully refill from empty, plus a 30-second margin — so an
inactive bucket expires on its own rather than accumulating forever. This
is centralized in `tokenBucket.js`'s `ttlFor()`, not computed ad hoc per
policy.

No raw user-supplied strings (e.g. a raw email) are ever used as a key
component — identities are either a MongoDB ObjectId string (`userId`,
already opaque) or an IP address.

## 6. Policies

All capacity/refillRate values are carried over unchanged from the old
limiters they replace — converted as `capacity = oldMax`,
`refillRate = oldMax / oldWindowSeconds` (same long-run average
throughput, same burst ceiling). **These are inherited values, not newly
tuned ones.** Every value is overridable via an environment variable
(`RATE_LIMIT_<NAME>_CAPACITY` / `RATE_LIMIT_<NAME>_REFILL_PER_SECOND`) —
see `src/lib/rateLimitPolicy.js` for the full list.

| Policy | Capacity | Refill rate | Old limiter it replaces |
|---|---|---|---|
| `AUTH` | 20 | 20/900s | `init.js` authLimiter (login/register/password-reset/verify) |
| `API` | 300 | 300/900s | `init.js` apiLimiter (general `/api` catch-all) |
| `AI` | 15 | 15/900s | `init.js` aiLimiter (generic HTTP guard on `/api/ai`) |
| `DISCOVERY` | 100 | 100/900s | `init.js` discoveryLimiter (search, friend requests, room/group create) |
| `DELETE` | 60 | 60/900s | `init.js` deleteLimiter (message/conversation/group deletion) |
| `VAULT_UNLOCK` | 8 | 8/900s | `init.js` vaultUnlockLimiter (PIN/WebAuthn unlock) |
| `INVITE_CREATE` | 20 | 20/3600s | `inviteRateLimit` `invite:create` |
| `INVITE_PREVIEW` | 30 | 30/60s | `inviteRateLimit` `invite:preview` |
| `INVITE_ACCEPT` | 20 | 20/60s | `inviteRateLimit` `invite:accept` |
| `MEETING_INVITE_CREATE` | 20 | 20/3600s | `inviteRateLimit` `meeting-invite:create` |
| `MEETING_INVITE_PREVIEW` | 30 | 30/60s | `inviteRateLimit` `meeting-invite:preview` |
| `MEETING_INVITE_ACCEPT` | 20 | 20/60s | `inviteRateLimit` `meeting-invite:accept` |
| `MESSAGE_SEND` | 60 | 60/60s | `inviteRateLimit` `message:send` |
| `MESSAGE_SEARCH` | 30 | 30/60s | `inviteRateLimit` `message:search` |
| `REPORT_CREATE` | 10 | 10/3600s | `inviteRateLimit` `report:create` |
| `PASSKEY_LOGIN` | 20 | 20/60s | `inviteRateLimit` `passkey:login` |
| `SECURITY_AI_ANALYZE` | 20 | 20/60s | `inviteRateLimit` `security-ai:analyze` |

`src/lib/sensorRateLimit.js` (eBPF sensor ingestion, keyed on
`req.sensor.sensorId`) and `src/lib/authCodeRateLimit.js` (password-reset
code requests, keyed on the target email) were **not** migrated — both
are genuinely separate identity models from userId/IP and were out of
scope for this pass.

## 7. Identity strategy

Each policy's middleware is constructed with a `keyResolver`
(`src/lib/createTokenBucketLimiter.js`):

- `KeyResolvers.byUser` — `req.user.id`. Used where the limiter runs after
  authentication (invite create/accept, message send/search, report
  create, security-AI analyze).
- `KeyResolvers.byIp` — `req.ip` (already resolved correctly for the
  deployment's real proxy topology by Express's own `trust proxy`
  setting — see `securityEventContext.js`'s comment on why nothing in
  this codebase reads `X-Forwarded-For` directly). Used for routes that
  run before authentication (the 6 `init.js` app-level limiters all run
  before `passport.initialize()` in the middleware chain — verified by
  reading the actual mount order, not assumed) and for genuinely
  unauthenticated routes (invite/meeting-invite preview, passkey login).
- `KeyResolvers.byUserOrIp` — the default; prefers the authenticated user
  when available, falls back to IP otherwise.

Never IP-only for an authenticated action (many legitimate users can
share one IP/NAT/office network), and never user-only for an
unauthenticated endpoint (there is no user identity yet).

## 8. Redis failure behavior

**Every policy fails closed.** If the Redis command itself fails (not
"no Redis configured" at all — a real connection/command error),
`createTokenBucketLimiter`'s middleware returns `429` with a 5-second
`Retry-After`, logs a structured `rate_limit_fail_closed_redis_unavailable`
warning (route, limiter name, identity *type* only — never the raw
identity value, address, or any Redis internals), and records a
`RATE_LIMIT_TRIGGERED`-shaped SecurityEvent is **not** recorded for this
path specifically (that event is reserved for an actual policy denial,
not an infrastructure failure) — the warning log is the signal for this
case.

A uniform fail-closed policy (rather than a fail-open/fail-closed split
per route) was a deliberate choice: splitting it would have recreated
exactly the old MemoryStore failure mode — unlimited traffic — for every
route classified as "not sensitive," and that classification is itself a
judgment call that's easy to get wrong in hindsight. The cost: a Redis
outage also throttles ordinary traffic, not just abuse. That's an
explicit, accepted trade-off, not an oversight.

**The Express process itself never crashes on a Redis error** —
`tokenBucket.js`'s `consumeToken()` catches every Redis error internally
and returns a `{ redisAvailable: false }` result; nothing throws past
that boundary.

This is a different posture from `src/ai/quota.js` (Zeph's AI governance
system), which deliberately fails *open* on a Redis error — see §10 for
why these two systems have different, equally deliberate, failure modes.

## 9. Horizontal scaling

This is the actual reason for the whole migration. Before:

```
Backend A → MemoryStore A (independent counter)
Backend B → MemoryStore B (independent counter)
Backend C → MemoryStore C (independent counter)
```

A user hitting all three instances (e.g. behind a load balancer with no
sticky sessions) effectively got 3× the intended budget. After:

```
Backend A ⟍
Backend B  → Redis (one shared bucket per policy+identity)
Backend C ⟍
```

Verified directly in `test/createTokenBucketLimiter.test.js`'s
"multi-instance sharing" test: two independently constructed middleware
instances (simulating two separate backend processes, sharing nothing but
the same Redis connection string) correctly share one bucket — exhausting
capacity through one "instance" causes the next request through the
*other* instance to also be rejected.

## 10. Why AI quota (`src/ai/quota.js`) remains a separate system

This migration deliberately does **not** touch `ai/quota.js`. The two
systems protect different things and have different failure postures:

- **Generic HTTP token bucket** (this document): protects infrastructure
  from request-volume abuse. Fails closed.
- **AI quota**: protects an expensive, metered, external resource (LLM
  provider calls) and enforces Zeph's own self-imposed product-usage
  ceilings (per-user/minute, per-user/day, per-user/IP concurrency,
  global concurrency). Fails **open** on a Redis error, by original
  design (`ai/quota.js`'s own comment: "a quota-tracking failure must not
  itself take AI down").

`/api/ai/*` routes are actually governed by **both**, in sequence: the
generic `AI` token bucket (an HTTP-layer guard, checked first, in
`init.js`) and then, inside the route handler, the full AI quota/
eligibility/dedup/concurrency pipeline. Removing either layer would
either reopen generic HTTP abuse on AI endpoints (removing the token
bucket) or remove Zeph's actual cost/product governance (removing AI
quota) — they are not redundant with each other.

## 11. Invite limiter migration

`src/lib/inviteRateLimit.js` (the old `Map`-based fixed-window limiter,
used at all 11 non-`init.js` call sites) has been deleted. Every call
site now uses `createTokenBucketLimiter` with the matching named policy
(see §6's table) and the correct identity resolver for its actual
position in that route's middleware chain (verified per-route, not
assumed — see §7).

**Nothing about invite business logic changed**: token generation,
hashing, expiration, revocation, max-uses enforcement, and acceptance
semantics are all untouched in `src/routes/meetings/invites/*.js` and
`src/routes/{friends,group}/invites/*.js`. A rate-limit pass only means
"this request may proceed to the route handler's own validation" — it
never implies the invite itself is valid, and the limiter and the
invite-authorization logic remain fully independent, exactly as before.

## 12. Testing — Redis availability in test files

Most backend tests run fully hermetic, with `test/helpers/db.js`'s
in-memory MongoDB and **no** real Redis connection for most subsystems
(`test/helpers/app.js` forces `redisUrl: null`). Rate limiting is the one
exception: because every migrated route now needs Redis to function at
all (fail-closed), `helpers/app.js` sets `rateLimitRedisUrl` — a
separate config key, read only by `src/lib/rateLimitClient.js`, that
defaults to the real `REDIS_URL` from the test environment, specifically
so BullMQ/the Socket.IO adapter/every *other* Redis-backed subsystem
stays hermetic while rate limiting alone gets a real connection. See
`config.js`'s own comment on `rateLimitRedisUrl`.

Dedicated unit/integration tests:

- `test/tokenBucket.test.js` — the core engine: atomicity, capacity
  ceiling, no-negative-tokens, refill-over-time, cost > 1, per-identity
  isolation, concurrent-request safety, TTL.
- `test/rateLimitPolicy.test.js` — every named policy resolves to valid,
  non-zero values; carried-over numbers match the old limiters exactly;
  env var overrides work and reject invalid overrides back to the
  default; fail-closed applies uniformly.
- `test/createTokenBucketLimiter.test.js` — the Express middleware:
  429 response shape, identity resolution (`byUser`/`byIp`/`byUserOrIp`),
  multi-instance bucket sharing, no Redis-internals leakage in responses.
- `test/message-send-rate-limit.test.js` — end-to-end through the real
  `/api/message` route, including the fail-closed-with-no-Redis case.
