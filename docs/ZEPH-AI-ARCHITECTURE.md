# Zeph AI — Architecture

**Status**: Phases 1-14 complete. Backend governance pipeline (Phases 1-9),
frontend integration (Phase 10), observability (Phase 11), realistic load
testing (Phase 12), cost/abuse hardening (Phase 13), and Meeting AI (Phase
14, transcription + summary) are all implemented and tested. See each
section below for what changed in Phases 10-14 specifically.

## Pipeline

```
Zeph Client
      ↓
AI API Gateway            (routes/ai/*.js — auth + room authorization + param validation)
      ↓
Eligibility Engine        (ai/policy.js + ai/eligibility.js)
      ↓
Quota / Abuse Protection  (ai/quota.js — Redis-backed, + init.js's aiLimiter)
      ↓
Context Builder + Token Budget  (ai/contextBuilder.js)
      ↓
Redis Cache / Dedup / Locks     (ai/dedup.js, ConversationSummary freshness)
      ↓
BullMQ AI Jobs             (queues/aiQueue.js, queues/aiWorker.js — summaries only)
      ↓
Groq API / Llama 3.1 8B Instant  (ai/provider.js)
      ↓
Output Validation          (ai/outputValidation.js)
      ↓
Cache / Persistence        (ConversationSummary, Redis dedup cache)
      ↓
User
```

Every stage fails toward "no AI result, rest of Zeph keeps working" — never
toward a thrown error that takes down a request path unrelated to AI.

## Request lifecycle (example: group summary)

1. `POST /api/ai/summarize` — `passport` JWT auth (routes/index.js), same as
   every other authenticated route.
2. Route handler loads the `Room`, checks the caller is a member (`403` if
   not) — same pattern as every other room-scoped route in this codebase.
3. `ai/eligibility.js` runs `checkSummaryEligibility` — an **indexed
   `Message.countDocuments({room, type:'text'})`** (Phase 18: never a full
   fetch counted in application code) against the group/DM threshold from
   `ai/policy.js`. Below threshold → `422 INSUFFICIENT_CONTEXT` with a
   human-readable message, no provider call made.
4. `ConversationSummary.findOne({room})` checks for an existing summary and
   `isSummaryStale()` compares `messageCountAtSummary` against the current
   count. Fresh → return the cached summary immediately, `cached: true`.
5. Stale/missing → if BullMQ (Redis) is configured, enqueue a job
   (`202 GENERATING`, plus the previous summary if one exists, so the UI has
   something to show while it waits) and return; the worker
   (`queues/aiWorker.js`) does the rest asynchronously. Without Redis, the
   same logic runs synchronously in the request (Phase 9 explicitly permits
   this fallback).
6. `ai/summaryService.js` fetches the last 200 text messages
   (count-bounded), builds bounded context (`ai/contextBuilder.js`, token-
   bounded on top of the count bound), and calls `ai/gateway.js#runGoverned`.
7. `runGoverned`: checks `AI_PROVIDER`/`enabled` → `checkQuota` (per-user
   minute/day/concurrent, per-IP minute, global concurrent — Redis INCR
   counters) → `acquireLock` (Phase 8 dedup, keyed
   `summary:{roomId}:{messageCount}`) → calls `provider.generate()` with a
   hard timeout (`AI_PROVIDER_TIMEOUT_MS`) → `validateTextOutput` → releases
   concurrency/lock in a `finally`.
8. On success: `ConversationSummary` is upserted (replace, not append —
   freshness is tracked by count, not history) and the result returned.

## Eligibility rules

| Feature | Rule | Config key |
|---|---|---|
| Group summary | ≥100 text messages | `AI_POLICY_GROUP_SUMMARY_MIN_MESSAGES` |
| DM summary | ≥30 text messages | `AI_POLICY_DM_SUMMARY_MIN_MESSAGES` |
| Conversation title | ≥5 text messages | `AI_POLICY_TITLE_MIN_MESSAGES` |
| Group topic extraction | ≥50 text messages, group only | `AI_POLICY_TOPIC_MIN_MESSAGES` |
| Smart reply / draft reply | none — bounded recent context (last 20 messages) | — |
| Message rewrite | none — single client-supplied message | — |
| Translation | none — single client-supplied message | — |
| Summary regeneration | ≥25 new messages since the cached summary | `AI_POLICY_SUMMARY_FRESHNESS_MIN_NEW_MESSAGES` |
| Meeting summary | meeting ended AND ≥5 min duration AND ≥2 participants AND ≥100 transcribed words | `AI_POLICY_MEETING_SUMMARY_MIN_DURATION_SECONDS`, `_MIN_PARTICIPANTS`, `_MIN_TRANSCRIPT_WORDS` |

Rejection reasons returned to the client (`ai/policy.js`'s
`REJECTION_REASONS`): `INSUFFICIENT_CONTEXT`, `QUOTA_EXCEEDED`,
`RATE_LIMITED`, `AI_DISABLED`, `PROVIDER_UNAVAILABLE`, `MEETING_TOO_SHORT`,
`INSUFFICIENT_PARTICIPANTS`, `INSUFFICIENT_TRANSCRIPT`, `MEETING_NOT_ENDED`,
plus `GENERATION_IN_PROGRESS` (Phase 8), `INVALID_OUTPUT` (Phase 12), and
`INPUT_TOO_LARGE` (Phase 13) from the gateway/route layer.

## Rate limits (portfolio-safe defaults, all configurable)

| Layer | Default | Config key |
|---|---|---|
| Per-user requests/minute | 5 | `AI_LIMIT_USER_PER_MINUTE` |
| Per-user requests/day | 50 | `AI_LIMIT_USER_PER_DAY` |
| Per-user concurrent requests | 2 | `AI_LIMIT_USER_CONCURRENT` |
| Per-IP requests/minute | 20 | `AI_LIMIT_IP_PER_MINUTE` |
| Global concurrent AI jobs | 10 | `AI_LIMIT_GLOBAL_CONCURRENT` |

These are **Zeph's own self-imposed ceilings**, deliberately stricter than
Groq's actual free-tier limits — not a restatement of what Groq allows. They
exist to protect Zeph's own Groq account from accidental exhaustion (a
runaway client, a scraping bot), not to approximate Groq's real quota.
Enforced only when `REDIS_URL` is configured; without Redis, every quota
check fails open (per-request governance is lost, but the pre-existing
`aiLimiter` express-rate-limit middleware — 15 requests/15min per IP,
`init.js`, mounted on `/api/ai` — remains as a baseline guard).

## Token/context budgets

- Input: ~4000 tokens (`AI_MAX_INPUT_TOKENS`), estimated as `chars / 4` (no
  tokenizer dependency — a bound, not a billing-accurate count).
- Output: ~800 tokens (`AI_MAX_OUTPUT_TOKENS`), enforced via the provider's
  own `max_tokens` parameter.
- `ai/contextBuilder.js` trims from the *oldest* message forward until the
  input budget is met, so the most recent — almost always most relevant —
  context survives.

## Deduplication and locking

`ai/dedup.js` — Redis `SET key value PX <ttl> NX` for lock acquisition, a
Lua `GET`-then-`DEL` compare-and-delete script for release (so a slow
caller can never release a different, later holder's lock). TTL: 30s (the
provider timeout plus margin) — a crashed lock holder self-heals, never
stuck permanently. Lock keys: `ai:lock:summary:{roomId}:{messageCount}`
(and equivalent for title/topics) — Phase 8's conceptual key, realized.

## BullMQ jobs

Only conversation summaries are queued (`queues/aiQueue.js`,
`queues/aiWorker.js`) — the one genuinely expensive, non-interactive
operation. Translate/rewrite/draft-reply/title/topics run synchronously in
the request path (Phase 9 explicitly permits this for lightweight,
single-call operations); all still go through the same governance gateway.
Job id = `summary:{roomId}:{messageCount}` — BullMQ itself refuses a second
job with the same id while one is active/waiting, so N simultaneous
summary requests enqueue at most once. `attempts: 2`, exponential backoff,
bounded `removeOnComplete`/`removeOnFail` retention (24h) — same
conventions as `queues/securityAiQueue.js`.

## Privacy and data minimization

- No auth tokens, passwords, API keys, or internal secrets are ever part of
  a prompt.
- Only the specific room's own recent message content is sent — never
  cross-conversation, never another user's private data.
- Authorization is checked *before* any AI logic runs (room membership) —
  AI is never itself an authorization decision-maker.
- `GROQ_API_KEY` lives in `config.js`/env only; it is in the outbound
  request's `Authorization` header and nowhere else — never logged (pino's
  redact config in `logger.js` also blankets `*.token`/`*.password`
  patterns generally), never sent to the frontend.

## Output validation and prompt-injection posture

`ai/outputValidation.js` treats every model response as untrusted external
input: must be a non-empty string under 4000 chars, or the request fails
safely (`INVALID_OUTPUT`, `502`) rather than passing malformed output
through. Model output is purely informational text (a summary, a
translation, a title suggestion) — it is never interpreted as an
instruction, never used to make an authorization decision, and never
executes a backend operation. User message content is only ever the
*subject* of a prompt (interpolated after a fixed instruction prefix), never
concatenated in a way that could be mistaken for system/application
instructions by the calling code — the distinction matters for the model's
behavior, not for Zeph's own trust boundary, since Zeph never lets model
output cross that boundary regardless of what the model was tricked into
saying.

## Failure handling

- Provider disabled/misconfigured → `503 AI_DISABLED` (no key) —
  fails closed, verified by `test/ai.test.js`.
- Provider timeout (`AI_PROVIDER_TIMEOUT_MS`, default 15s) → `502
  PROVIDER_UNAVAILABLE`.
- Provider HTTP 429 → `429 RATE_LIMITED` (Groq's own limit, distinct from
  Zeph's self-imposed quota rejections, which also return 429).
- Malformed/empty output → `502 INVALID_OUTPUT`.
- No retries beyond BullMQ's own `attempts: 2` for the queued summary path
  — an AI failure is not retried indefinitely, and a failed/unavailable
  result is not treated as a BullMQ job failure worth backoff (it's already
  classified and logged).
- **Messaging, calls, authentication, and every other Zeph feature are
  unaffected by any AI failure mode** — verified by the fact that no
  non-AI route imports anything from `ai/` or `queues/aiQueue.js`.

## Big-O analysis

| Operation | Complexity | Notes |
|---|---|---|
| Eligibility check | O(1) | Indexed `countDocuments` on `{room:1}` |
| Redis quota lookup | O(1) avg | Single-key INCR/GET |
| Distributed lock acquire/release | O(1) avg | Single-key SET NX / Lua compare-delete |
| Cached summary lookup | O(1) avg | Unique-indexed `{room:1}` on `ConversationSummary` |
| Indexed message retrieval | O(log n + k) | n = total messages in room, k = retrieved (200 cap) |
| Context construction | O(k) | k = messages after the count cap |
| Output validation | O(r) | r = output length (bounded ≤4000 chars) |
| Summary trim-to-budget | O(k) | Linear scan trimming from the front, bounded by k |

**LLM inference itself is explicitly NOT modeled as O(n) or any other simple
closed form here** — actual latency depends on Groq's model architecture,
sequence length, their infrastructure's batching/scheduling, and network
conditions, none of which Zeph controls or should claim to characterize.
What Zeph *does* control and document is the **input bound** (~4000 tokens)
and **output bound** (~800 tokens) that keep the workload handed to the
model small and predictable, regardless of the model's own internal
complexity.

## Database indexes used

No new indexes were added — Zeph AI reuses `Message`'s existing
`{room: 1}` index (`models/Message.js`) for both eligibility counts and
recent-message retrieval, and adds one new unique index
(`{room: 1}` on `ConversationSummary`, implicit from `unique: true` on the
`room` field) for O(1) summary lookup/upsert.

## Cost control ($0 target)

- **Groq**: free tier, Llama 3.1 8B Instant. Zeph's own rate limits (above)
  are deliberately stricter than Groq's actual free-tier limits — this is a
  self-protective ceiling, not a claim about what Groq allows.
- **Redis, BullMQ, MongoDB**: all already-deployed Zeph infrastructure,
  reused as-is — Zeph AI adds one more `ioredis` client
  (`ai/redisClient.js`, following the established one-client-per-concern
  convention already used by `securityAi/cache.js`, `threatIntel/quota.js`,
  etc.) and one more BullMQ queue, not a new infrastructure category.
- **No GPU hosting, no self-hosted model serving, no vector database** —
  none were added.
- Zeph AI makes **no claim of unlimited requests, unlimited concurrency, or
  production-scale inference.** It is sized for realistic portfolio traffic
  (a handful of concurrent users), and is designed to fail closed/degrade
  gracefully rather than silently exceed a free-tier budget.

## Phase 10 — Frontend integration

Every AI feature is wired into the real chat/meeting UI, not a demo page:

| Feature | Where | Component |
|---|---|---|
| Summarize | Conversation "More options" menu | `TopBar.jsx` |
| Extract topics | Conversation "More options" menu, groups only | `TopBar.jsx` |
| Draft reply | Composer icon button | `BottomBar.jsx` |
| Rewrite | Composer icon button, shown once text is typed | `BottomBar.jsx` |
| Translate | Per-message hover menu → language picker | `Message.jsx` |
| Record & summarize (Meeting AI) | Call control bar, opt-in record button | `Meeting/components/MeetingRecorder.jsx` |

Every action:
- Shows a spinning-icon busy state and disables its own trigger while a
  request is in flight — a second click while busy is a no-op (`if (busy)
  return` at the top of each handler), not just a disabled DOM attribute.
- Cancels its own in-flight request on unmount via `AbortController` (stored
  in a `useRef`, aborted in a cleanup `useEffect`) — a fast unmount/route
  change never calls `setState` on a gone component and never leaves a
  stale request racing a newer one for the same action.
- Renders backend rejection reasons through one shared helper,
  `frontend/src/lib/aiErrorMessage.js`, so eligibility/quota/rate-limit/
  disabled/invalid-output failures get consistent, specific copy everywhere
  (`INSUFFICIENT_CONTEXT` reuses the backend's own precise threshold
  message verbatim, e.g. "Zeph needs at least 100 messages...") without
  ever mentioning Groq/Redis/BullMQ by name.
- Never talks to Groq directly — every action calls a Zeph backend route
  through a thin `actions/*.js` wrapper (axios), matching this codebase's
  existing action-file convention exactly.

Summarize's 202 (queued) response shows any previous cached summary
immediately as a placeholder while the new one generates, rather than a
bare spinner with no content.

## Phase 11 — Observability

Every AI request emits structured pino log events carrying a `requestId`
that survives the full pipeline, including a queue hop:

| Event | Emitted from | Key fields |
|---|---|---|
| `ai_eligibility_rejected` | route (`ai/telemetry.js`) | requestId, feature, scope, reason, minMessages, count |
| `ai_cache_hit` | route | requestId, feature, scope, messageCountAtSummary, currentCount |
| `ai_job_queued` | route | requestId, feature, scope |
| `ai_quota_rejected` | gateway | requestId, feature, reason, detail |
| `ai_dedup_in_progress` | gateway | requestId, feature |
| `ai_provider_call_failed` | gateway | requestId, feature, reason, isTimeout, providerLatencyMs |
| `ai_output_validation_failed` | gateway | requestId, feature, reason, providerLatencyMs |
| `ai_request_succeeded` | gateway | requestId, feature, scope, inputTokenEstimate, outputTokenEstimate, queueWaitMs, providerLatencyMs, totalLatencyMs |
| `ai_worker_summary_generated` / `_unavailable` | queues/aiWorker.js | requestId, roomId, queueWaitMs (from BullMQ's own `job.timestamp`), attemptsMade |
| `ai_worker_job_failed` | queues/aiWorker.js | requestId, roomId, err, attemptsMade |
| `meeting_ai_transcribed` / `_worker_*` | meetingTranscriptService.js / meetingAiWorker.js | requestId, meetingId, wordCount, queueWaitMs |

`requestId` is `req.id` (pino-http, real deployments) with a uuid fallback
(`ai/telemetry.js#resolveRequestId`) so it's always a real string even in
contexts without pino-http (the Jest test harness) — verified by
`test/ai.test.js`'s "every response carries a requestId" cases and
`test/aiGateway.test.js`.

**Never logged**: message/transcript/prompt/summary content, `GROQ_API_KEY`,
any token/password (pino's global `redact` config, `logger.js`, still
applies on top). Every event above logs only ids, enums, counts, and
durations.

**No new observability dependency was added** — this codebase's own Phase 8
audit already declined to add APM/tracing for a single measurement pass;
the same reasoning applies here. "Dashboards" means: these are the fields
to graph against any log aggregator this deployment already has (e.g.
`providerLatencyMs` p95 over time, `ai_quota_rejected` count by `reason`,
`queueWaitMs` distribution) — not a shipped dashboard app.

## Phase 12 — Load testing

`backend/loadtest/ai-load.js` (+ `mock-groq-server.js`, `seed-ai-room.js`) —
same plain-Node, no-new-dependency convention as the existing
`http-load.js`/`message-only-load.js`. See `backend/loadtest/README.md` for
the full methodology (local throwaway Mongo+Redis, why real shared infra is
never touched).

**What it measures vs. does not measure**: the AI load test exercises the
real Zeph AI governance pipeline (route auth → eligibility → quota → dedup
lock → gateway → output validation → persistence → BullMQ) against a real
local backend + local Redis/Mongo. The actual "provider call" talks to
`mock-groq-server.js` — a tiny local HTTP stand-in with a fixed artificial
delay (300ms in the run below) — **never the real Groq API**, so this never
burns real quota/cost, matching the same principle this repo's load-test
suite already applies to Mongo/Redis. Every "provider latency" figure below
is therefore explicitly a **simulated** number bounded by the mock's
artificial delay, not Groq's real production latency, which this project
has no way to responsibly load-test.

### Measured results (2026-09-05, this exact run)

Environment: local `mongod`/`redis-server` (Windows), `mock-groq-server.js`
with a 300ms artificial delay, backend on `AI_PROVIDER=groq` pointed at the
mock via `GROQ_BASE_URL`, default rate limits
(`AI_LIMIT_USER_PER_MINUTE=5`, etc.), concurrency=20.

**A. 20 concurrent identical group-summary requests (dedup test)**, a fresh
group room with 105 eligible messages, first 10 tokens are real members,
next 10 are non-members:

```
status code breakdown: {"202":10,"403":5,"429":5}
p50: 192.6ms   p95: 287.2ms   p99: 297.2ms   min: 116.1ms   max: 297.2ms
```

All 10 real members received `202 GENERATING` from a **single** enqueued
BullMQ job (`jobId: summary:{roomId}:{count}` — confirmed via server logs:
exactly one `ai_job_queued` line, one `ai_request_succeeded`, one
`ai_worker_summary_generated`, all sharing one `requestId`) — 10 concurrent
identical requests produced 1 provider call, not 10. The 5 non-members
correctly got `403`; the remaining 5 landed on the pre-existing
`aiLimiter` express-rate-limit's 15-requests/15-min-per-IP ceiling (a
separate, IP-wide layer — see the note on limiter interaction below).

**B. Repeated requests for an already-cached summary** (immediately after A,
summary already `SUMMARIZED`):

```
total: 20   errors: 0
p50: 59.7ms   p95: 102.1ms   p99: 106.8ms   min: 24.5ms   max: 106.8ms
```

Every one of these returned the cached `ConversationSummary` document
(`cached: true`) — no provider call, confirmed by log inspection (zero new
`ai_request_succeeded` lines during this batch).

**C. Translate, 20 concurrent requests from distinct users**:

```
total: 20   errors: 0
p50: 70.6ms   p95: 95.9ms   p99: 101.6ms   min: 38.1ms   max: 101.6ms
```

**D. Burst — 15 rapid sequential requests from ONE user** (isolated run,
fresh backend, default per-minute quota = 5):

```
i=0..4:  200 (≈325-535ms each — real simulated-provider round trip)
i=5..14: 429 (≈6-16ms each — rejected before any provider call)
```

Exactly 5 succeeded, 10 were rejected — the per-user quota (`ai/quota.js`)
enforced precisely at its configured threshold, and rejected requests
returned in single-digit milliseconds (no provider call attempted),
confirming Phase 13's "failed/rejected requests must not incur provider
latency" property empirically, not just by code inspection.

**E. Large-conversation summary (500 messages)**, isolated run:

```
202 GENERATING — 162ms (enqueue only)
Retry 3s later: 200, cached:true — 127ms
```

Server log for the actual generation (one `requestId` across every stage):

```
ai_job_queued          requestId=2 feature=conversation_summary scope=group
ai_request_succeeded   requestId=2 inputTokenEstimate=4019 queueWaitMs=6
                       providerLatencyMs=383 totalLatencyMs=395 outputTokenEstimate=13
ai_worker_summary_generated  requestId=2 queueWaitMs=11 attemptsMade=0
```

`inputTokenEstimate=4019` for a 500-message room, right at the
`AI_MAX_INPUT_TOKENS=4000` budget — confirming the context builder's
oldest-message-trim actually bounds a genuinely large conversation, not
just in unit tests.

### A real limiter interaction, documented rather than hidden

`aiLimiter` (`init.js`, 15 requests/15min/IP, applies to every `/api/ai/*`
route) and Zeph's own per-user quota (`ai/quota.js`, `AI_LIMIT_USER_PER_MINUTE=5`
by default) are two independent layers. Running every scenario above from
one source IP in a single process means an earlier scenario's requests
count against the later scenarios' shared IP budget — scenario D and E's
`429`s in a combined run reflect `aiLimiter`'s IP ceiling, not their own
per-scenario logic, until the backend is restarted (which resets
`aiLimiter`'s in-memory state) between runs. This is the same documented
behavior `loadtest/README.md` already describes for `authLimiter`/
`discoveryLimiter`/`messageSendLimit` — restarting between scenarios (as
done for the isolated D/E numbers above) is how this codebase's existing
load-test suite handles it, not a new workaround.

### What this does NOT claim

No specific requests-per-second, concurrent-user, or "requests Zeph AI can
sustain in production" number is claimed anywhere in this document. The
numbers above describe one small (concurrency=20) run on one developer
machine against a simulated provider — they demonstrate the pipeline
*works correctly* (dedup collapses N→1, cache hits skip the provider,
quota rejects cleanly and fast, context bounds a 500-message room), not a
production capacity ceiling. A real deployment should run
`backend/loadtest/ai-load.js` against its own infrastructure before trusting
any number for that deployment specifically.

## Phase 13 — Cost + abuse hardening (audit findings and fixes)

Auditing the Phase 1-9 implementation for the exact failure modes this
phase lists surfaced two real, fixed bugs — not just added tests for
already-correct behavior:

1. **Failed provider calls were consuming quota.** The original
   `ai/quota.js#checkQuota` incremented the per-user minute/day Redis
   counters on every *attempt*, before knowing whether the provider call
   would succeed. A user hitting nothing but Groq timeouts/5xx could
   exhaust their entire daily quota without ever receiving one successful
   AI result. **Fix**: `checkQuota` is now read-only (GET, never INCR);
   `recordUsage()` is a separate function `ai/gateway.js#runGoverned` calls
   *only* after `validateTextOutput` confirms a genuinely usable response.
   Concurrency counters (which track "in flight," not "succeeded") still
   bracket the whole attempt including failures — that distinction is
   intentional and documented in `ai/quota.js`. Regression-tested in
   `test/aiGateway.test.js` (mocked quota module, asserts `recordUsage` is
   called on success and never called on provider failure, invalid output,
   or a pre-rejected quota check).

2. **A single oversized message bypassed the token budget entirely.**
   `ai/contextBuilder.js#buildBoundedContext`'s trim loop drops whole
   messages from the front until the budget is met — but for a
   single-message call (`translate`/`rewrite`, which take raw client text
   with no separate length cap), `messagesUsed` can never go below 1, so a
   multi-megabyte string sailed through untouched (confirmed: a 2MB input
   produced a 500,002-token estimate, 125x over the 4000-token budget,
   before this fix). **Fix**: every message's content is hard-truncated to
   `MAX_MESSAGE_CHARS` (20,000) before the trim loop runs, and the final
   joined text has a hard `maxInputTokens*4`-character ceiling as a last
   resort. Additionally, `routes/ai/translate.js` and `rewrite.js` now
   reject oversized input with `413 INPUT_TOO_LARGE` *before* any
   context-building or provider work — cheaper than letting the context
   builder silently truncate. Regression-tested in
   `test/aiContextBuilder.test.js` and `test/ai.test.js`.

Existing controls verified (not newly built) during this audit: BullMQ
retry is already bounded (`attempts: 2`, exponential backoff — no
retry-storm risk); a failed/unavailable AI result is explicitly *not*
treated as a BullMQ job failure worth retrying (already correct); Groq
429/5xx/timeout are already classified and mapped to distinct rejection
reasons; AI authorization (room membership) already runs independently of
and before any AI logic, so AI can never bypass RBAC.

## Phase 14 — Meeting AI

A real feature, not a placeholder: client-side audio capture → upload →
Groq Whisper transcription → eligibility check → Groq chat-completion
summary → persistence, all through the existing governance gateway.

### Why client-side capture, not a server-side mediasoup tap

Investigated first: mediasoup has no plain-transport/RTP-recording plumbing
in this codebase, and — more importantly — **mediasoup itself is disabled
in this app's own production deployment** (`MEDIASOUP_ENABLED=false`, see
`docs/PHASE8-CAPACITY-REPORT.md` — the current host lacks the native build
toolchain). Building a server-side recording pipeline on top of a subsystem
that doesn't run in production would be dead code in the one environment
that matters. Client-side `MediaRecorder` on the caller's own local
microphone stream, uploaded through the *already-existing* generic media
pipeline (`upload-media.js`, `audio` category, already in
`mediaPolicy.js`), is consistent with how every other media type in this
app already works and needs zero new upload infrastructure.

### Pipeline

```
User clicks Record (explicit opt-in, MeetingRecorder.jsx)
      ↓
MediaRecorder on the local mic stream (own audio only — never
remote participants', which this client has no raw access to anyway)
      ↓
Stop → Blob → uploadMedia() (existing pipeline, category: audio)
      ↓
POST /api/meeting/:id/summarize { mediaId }
      ↓
Authorization (caller/callee/recorded participant/current group member —
same check meeting join uses, reimplemented standalone so this route
works even with MEDIASOUP_ENABLED=false)
      ↓
BullMQ (queues/meetingAiQueue.js/meetingAiWorker.js) or synchronous fallback
      ↓
ai/meetingTranscriptService.js#transcribeMeetingAudio:
  fetch audio from storage.js → provider.transcribe() (Groq Whisper) →
  persist MeetingTranscript.transcript → DELETE the raw audio (Media +
  storage object) — only text persists past this point
      ↓
ai/eligibility.js#checkMeetingSummaryEligibility:
  Meeting.endedAt set? duration ≥5min? participants ≥2? transcript ≥100 words?
      ↓
generateMeetingSummary: chunk/bound transcript (reuses
ai/contextBuilder.js) → ai/gateway.js#runGoverned (same quota/dedup/
validation pipeline every other Zeph AI feature uses) → persist
MeetingTranscript.summary
      ↓
GET /api/meeting/:id/summary (frontend polls this after a 202)
```

### Meeting lifecycle change

`Meeting.endedAt` (new field) is set by `mediasoup/index.js#leaveRoom` only
when the *last* participant leaves (checked via `consumerUserIDs`, not on
every individual departure — a brief drop-and-rejoin by one participant
must not make an ongoing meeting look "ended"). Eligibility's duration
calculation (`endedAt - startedAt`) depends on this being set correctly;
`MEETING_NOT_ENDED` is returned if it isn't yet.

### Privacy boundary

The raw audio recording is deleted (`storage.deleteObject` + `Media`
document removal) immediately after successful transcription — **only the
transcribed text persists**, in `MeetingTranscript`, a collection separate
from `Meeting` itself so it has its own access boundary. Nothing in this
pipeline retains audio bytes longer than the single transcription call
requires.

### Duplicate-generation prevention

`queues/meetingAiQueue.js` uses `jobId: meeting:{meetingId}` — BullMQ
refuses a second job for the same meeting while one is active/waiting, and
`generateMeetingSummary` itself checks for an existing `SUMMARIZED`
transcript before calling the provider again (verified in
`test/meetingAi.test.js`'s "reuses an already-summarized transcript"
case).

### Provider requirement

Transcription requires `AI_PROVIDER=groq` specifically — Ollama has no
bundled speech-to-text integration in this codebase
(`ai/provider.js`'s ollama `transcribe()` stub throws a clear error rather
than silently no-op-ing). `GET /api/info`'s new `meetingAiEnabled` field
(distinct from the existing `aiEnabled`) lets the frontend show the
record button only when transcription will actually work, even on a
deployment running `AI_PROVIDER=ollama` for the text-only chat assistant.

### Tests

`test/aiMeetingEligibility.test.js` (12 cases: below/at/above duration,
participant count, transcript word count, the task's own documented
example scenarios), `test/meetingAi.test.js` (13 cases: disabled-by-default,
authorization, every eligibility rejection at the API level, successful
generation, audio-deletion-after-transcription, duplicate-generation
reuse, `GET .../summary` polling), `test/aiProvider.test.js`'s `transcribe()`
cases (success, API-key-never-in-body, 429, other HTTP failures, Ollama's
unsupported-error path). Frontend: `MeetingRecorder.test.jsx` (6 cases: no
microphone, synchronous success, eligibility rejection message, async/
polled path, polling-reports-FAILED, upload failure).

## Known limitations

- Redis-backed quota/dedup fails open when Redis is unavailable — the
  `aiLimiter` express-rate-limit middleware is the remaining protection in
  that case, which is IP-based only (no per-user/day/concurrency dimension).
- Load-test numbers (Phase 12) are from one small, local, simulated-provider
  run on one developer machine — they demonstrate correct pipeline behavior,
  not a production capacity ceiling for any real deployment. Never treat
  them as a scale claim.
- Meeting AI's transcription is a single provider call per meeting (no
  chunked/streaming transcription) — Groq's Whisper endpoint handles the
  25MB file size this app's own `mediaPolicy.js` already caps audio at, so
  this has not been a practical limitation, but a very long meeting's
  recording could in principle approach that ceiling.
- No hierarchical/incremental multi-pass summarization for either
  conversations or meeting transcripts — the context builder's
  recency-biased token-budget trim is the whole strategy, deliberately
  (see `ai/summaryService.js`'s own note); build a real chunk-then-merge
  pipeline only if an actual requirement (very long histories) appears.
