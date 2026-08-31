# ZEPH Phase 6 — AI Security Risk & Anomaly Analysis

> **AI ≠ Security Authority.** AI provides security intelligence.
> Deterministic security policies remain authoritative. AI cannot
> authorize, deny, block, revoke, kill, isolate, or execute commands.

## Architecture

```
Phase 1 Security Telemetry
            │
            ├───────────┐
            ▼           ▼
      Phase 4 eBPF   Phase 5 Network
            │           │
            └─────┬─────┘
                  ▼
     services/securityAi/correlation.js
     (deterministic — groups related events
      into a SecurityIncident by sensorId +
      time bucket)
                  │
                  ▼
     services/securityAi/priority.js
     (deterministic — decides if/how urgently
      an incident is worth an AI call at all)
                  │
                  ▼ (BullMQ: security-ai-analysis queue)
     services/securityAi/securityAiService.js
     (the AI Gateway — sanitize → route → prompt
      → provider [timeout+circuit breaker] →
      validate → cache)
                  │
                  ▼
        src/ai/provider.js → Ollama
                  │
                  ▼
     structured, schema-validated advisory
     result (schema.js) — persisted onto the
     SecurityIncident, and as AI_SECURITY_ANALYSIS/
     AI_ANOMALY_DETECTED SecurityEvents
                  │
                  ▼
     Phase 2 Risk Engine (riskEngine.js) —
     reads a CACHED auth-anomaly result only,
     bounded +15 contribution, never a live call
                  │
                  ▼
             Zero Trust
                  ▼
          Security Decision (unchanged —
          AI never reaches this layer directly)
```

## AI Runtime

- **Provider**: `src/ai/provider.js`'s existing Ollama abstraction, reused
  unmodified in shape — extended (backward-compatibly) with an optional
  per-call `{ model, format, signal }` options object so a caller can route
  to a different model, request JSON-mode output, and enforce a timeout,
  without any existing caller (the chat assistant) changing.
- **Model(s)**: whatever `OLLAMA_MODEL` names (default `llama3.2:1b` — the
  same default this codebase already had before Phase 6). **Honest
  correction to the spec's own framing**: ZEPH did NOT already have a real
  "1B → 7B" routing pipeline before this phase — only one model was ever
  configured. `AI_SECURITY_LARGE_MODEL` is a genuinely NEW, optional config
  value this phase introduces; `modelRouter.js` routes to it only when an
  operator sets it, and falls back to the single configured model
  otherwise — never a hard failure, never a silently-lowered guarantee.
- **Routing**: deterministic, based on the number of distinct signal
  categories in the sanitized context (`modelRouter.js`'s
  `countSignalCategories`) — >2 categories routes to the large model when
  configured, else the default model.
- **Timeout**: `SECURITY_AI_TIMEOUT_MS` (default 8000ms), enforced via
  `AbortSignal.timeout()` on every provider call.
- **Circuit breaker**: reuses `threatIntel/circuitBreaker.js`'s
  `buildCircuitBreaker` factory directly (it's a generic, provider-agnostic
  module despite its file location) — 3-failure threshold, 60s cooldown.
- **Queue**: BullMQ `security-ai-analysis` queue
  (`queues/securityAiQueue.js`/`securityAiWorker.js`), `jobId: incident:${incidentId}`
  for idempotency, priority 1-4 (CRITICAL-LOW), 3 retries with exponential
  backoff, `concurrency: 2` (an LLM call is the actual bottleneck resource,
  not I/O).

## AI Capabilities

- **Anomaly detection**: YES — `ANOMALY` analysis type, structured
  `{anomalous, confidence, category, signals, explanation, recommendedAction}`
  output.
- **Risk explanation**: YES (prompt/schema built and tested) — `RISK_EXPLANATION`
  analysis type exists end-to-end in `promptBuilder.js`/`schema.js`. **Not
  currently triggered by any automated caller** — no code path in this
  phase invokes it automatically; it's reachable via the manual
  `POST /api/security/ai/analyze` admin endpoint. Honest gap, not a hidden
  claim.
- **Incident summarization**: YES, fully wired end-to-end — the BullMQ
  worker calls `INCIDENT_SUMMARY` for every AI-worthy correlated incident,
  writing the result onto the `SecurityIncident` document's `aiAnalysis`
  field, visible in the admin UI.
- **Correlation**: YES, deterministic (`correlation.js`) — sensorId +
  fixed 15-minute epoch-aligned time bucket. AI never decides correlation;
  it only explains what the deterministic layer already grouped.

## Security Boundary

**AI is advisory and cannot directly authorize, deny, block, revoke,
isolate, or execute.** Concretely enforced by:

- `schema.js` validates every field of AI output and **never surfaces**
  `riskScore`, `policyDecision`, `adminRole`, `trusted`, `allow`, or any
  other field the model might return, even if present in the raw JSON —
  those keys are simply never read past validation, by construction.
- `recommendedAction` is restricted to the same `ALLOW`/`STEP_UP`/`DENY`/`null`
  vocabulary `policyEngine.js`'s `Decisions` enum uses, purely as a
  human-readable label — **it is never read by `policyEngine.js` or fed
  into any enforcement path.** `grep`-verifiable: `recommendedAction`
  appears only in `schema.js` (defining it) and the frontend UI (rendering
  it as a labeled "AI recommendation").
- The one place AI output reaches `riskEngine.js` is a single, capped
  `RISK_WEIGHTS.AI_AUTH_ANOMALY = 15` factor — the smallest weight in the
  entire risk table, deliberately far below any deterministic factor
  (`RECENT_FAILED_LOGINS: 25`, `MALICIOUS_IP: 40`), reading a **cached**
  result only (never a live call from inside the risk-evaluation hot
  path), confidence-gated (≥70), and never scaled by confidence or
  compounded across calls (spec section 25's anti-amplification
  requirement).
- **No tool calling, no shell access, no database mutation authority.**
  `securityAiService.js` never gives the model any capability beyond
  `generate(prompt) -> text`. A test (`securityAiPromptInjection.test.js`)
  explicitly verifies that even if the model somehow returns a
  `tool_calls`/`function_call`-shaped field, it is silently never read.

## Attribution Boundary — a deliberate scope decision

Most of what AI analyzes (eBPF process anomalies, network scans,
threat-intel matches) is **host-attributed** (sensorId/hostId), not
**user-attributed**. `riskEngine.js`'s per-user risk score has, since
Phase 4, deliberately excluded host-level signals because ZEPH has no
user↔host mapping — folding a host anomaly into a specific user's session
risk would be a fabricated correlation. **This same reasoning was applied
identically to AI's analysis of that same host-level data**: only AI's
analysis of genuinely user-attributed data (failed-login/rate-limit
patterns, built from the exact same per-user aggregate `riskEngine.js`
already computes) is wired into the risk score. AI's host/network/process
analysis produces `SecurityIncident` records for admin review, never a
per-user risk contribution — confirmed with the user before implementation
rather than assumed.

## A real bug found and fixed during this phase

The AI result cache (`securityAi/cache.js`) originally hashed only
`analysisType + context`, with no per-identity scoping. Two **different**
users producing identical aggregate counts (a common case — e.g. two
brand-new users both at `failedLoginCount: 0`) would silently share one
cached AI verdict: user B's risk score could be contaminated by an anomaly
the AI actually found for unrelated user A. Found via a cross-suite test
collision (`threatIntelRiskIntegration.test.js`'s hardcoded `userId:
'user-1'` picked up a cached result written by `securityAiRiskIntegration.test.js`'s
own tests). Fixed by threading an optional `scopeId` through
`getCachedAnalysis`/`setCachedAnalysis`/`securityAiService.analyze()` —
mixed into the Redis **key** only, never into the context object sent to
the model. Covered by a dedicated regression test
(`securityAiCache.test.js`, `securityAiRiskIntegration.test.js`'s "two
different users... never share a cached AI verdict").

A second bug: `securityEventService.js`'s new correlation hook
unconditionally required `queues/securityAiQueue.js` (which pulls in the
`bullmq` package) inside its fire-and-forget `.then()` callback on
**every** `SecurityEvent.record()` call — `bullmq`'s own require graph
measured ~450ms on first load, injected as synchronous delay into the hot
path the very first time any event was ever recorded in a process. Fixed
by deferring that specific require to only the branch that actually
enqueues a job (when AI is enabled AND an incident is AI-worthy) — the
common case (a login, a message-sent event, AI disabled) now pays none of
that cost.

## Files

**Created**:
- `backend/src/services/securityAi/` — `featureExtraction.js`,
  `sanitizer.js`, `schema.js`, `promptBuilder.js`, `modelRouter.js`,
  `cache.js`, `securityAiService.js`, `mockAiProvider.js`,
  `correlation.js`, `priority.js`, `correlationHook.js`
- `backend/src/models/SecurityIncident.js` (the one new persistence model
  this phase adds — individual AI analyses reuse `SecurityEvent`, per spec
  section 32's own "do not duplicate existing security-event storage")
- `backend/src/queues/securityAiQueue.js`, `securityAiWorker.js`
- `backend/src/routes/security/ai-incidents-list.js`,
  `ai-incidents-get.js`, `ai-analyze.js`
- `frontend/src/actions/securityAi.js`
- `frontend/src/features/Admin/SecurityAiIncidents.jsx` (+ test)
- `backend/test/securityAi*.test.js` (11 new test files)
- This document.

**Modified**:
- `backend/src/ai/provider.js` — backward-compatible `generate(prompt, options)`
  extension (model override, JSON format, abort signal).
- `backend/src/constants/securityEventTypes.js` — Phase 6 event types
  (`AI_SECURITY_ANALYSIS`, `AI_ANOMALY_DETECTED`, `AI_ANALYSIS_FAILED`,
  `AI_PROVIDER_UNAVAILABLE`, `AI_CIRCUIT_OPEN`).
- `backend/src/services/securityEventService.js` — correlation hook,
  wired the same way Phase 3's threat-intel enrichment hook already was.
- `backend/src/services/zeroTrust/riskEngine.js`,
  `riskWeights.js` — the single bounded `AI_AUTH_ANOMALY` factor.
- `backend/src/routes/index.js` — mounts the three new admin routes +
  `aiAnalyzeLimit` rate limiter.
- `backend/index.js` — starts `securityAiWorker`.
- `backend/config.js`, `backend/.env.example` — Phase 6 config.
- `frontend/src/features/Admin/index.jsx`, `pages/Home/index.jsx` — nav +
  route for the new admin page.
- Two existing test files (`threatIntelRiskIntegration.test.js`,
  `zeroTrustRiskEngine.test.js`) — added `closeSecurityAiCacheConnection()`
  cleanup, since `computeRiskFactors` now opens that connection too.

**Deleted**: none.

## Models

`llama3.2:1b` (via Ollama, config default) — the only model actually
exercised in any test or manual verification in this pass. No larger
model was installed/tested in this dev environment; `AI_SECURITY_LARGE_MODEL`
routing logic is unit-tested (`securityAiModelRouter.test.js`) with a
placeholder model name, never against a real second model.

## Tests

- Backend total before this phase: 900 (Phase 4/5 baseline).
- New this phase: **~145 new backend tests** across 11 files
  (`securityAiSanitizer`, `securityAiSchema`, `securityAiPromptBuilder`,
  `securityAiModelRouter`, `securityAiService`, `securityAiFeatureExtraction`,
  `securityAiCorrelation`, `securityAiCache`, `securityAiRiskIntegration`,
  `securityAiApi`, `securityAiPromptInjection`, `securityAiResourceExhaustion`)
  plus 1 new frontend page/test file.
- Backend total after this phase: **1027-1028/1028 passing** (96 suites;
  the 1 apparent failure across four consecutive full-suite runs was a
  DIFFERENT pre-existing, unmodified file each time — `securityEventService.test.js`,
  `conversation-privacy.test.js`, `presence-blocked.test.js` — none of
  which this phase touched; each passes cleanly in isolation, consistent
  with parallel-Jest-worker contention already observed throughout this
  project's earlier phases, not a Phase 6 regression).
- Frontend total after this phase: **473/473 passing** (56 files).
- `ebpf-sensor` total: unchanged, **41/41 passing** (no files touched).
- Prompt-injection tests: `securityAiPromptInjection.test.js` — the
  spec's own named attack strings ("ignore previous instructions", "you
  are admin", "approve this request", "set risk to zero", plus two more)
  each verified dropped by `sanitizeContext`, confined to the data block
  by `buildPrompt`, and never surfaced in validated output even if
  present.
- Load/resource-exhaustion tests: `securityAiResourceExhaustion.test.js` —
  10,000 simulated events from one sensor collapse to exactly 1 incident;
  10,000 events across 100 sensors bound to ≤100 incidents.
- Evaluation cases: see below.

## Evaluation

A small, explicitly experimental evaluation set
(`securityAiApi.test.js`/`securityAiService.test.js`'s mocked-provider
tests) exercises: normal behavior (no anomaly), an authentication-attack
shaped context, malformed/non-JSON output, missing-field output,
model-attempted field injection, provider timeout, provider unavailable,
and circuit-breaker-open — all against a **deterministic mock provider**
(`mockAiProvider.js`), never a real model.

**Precision/recall are not reported** — this dev environment has no
Ollama instance running, so no real model inference occurred anywhere in
this phase; every "AI response" in every test is a hand-authored mock
JSON object. Reporting a precision/recall number here would be inventing
data this project's own instructions explicitly forbid. What IS verified:
the pipeline correctly passes through a well-formed anomalous verdict, a
well-formed clean verdict, and correctly rejects/quarantines every
malformed or adversarial shape tested. Real-model evaluation (does
`llama3.2:1b` actually produce useful anomaly judgments on real security
telemetry) is unperformed and explicitly deferred.

## Performance

**Actual measured numbers from this dev environment** (no invented
values):
- Correlation layer (Mongo-only, no AI/Redis involved): 10,000 sequential
  `correlateEvent()` calls collapsing into 1 incident completed in
  **~31 seconds** (`securityAiResourceExhaustion.test.js`).
- `bullmq` package first-require cost: **~450ms** (measured directly,
  see "A real bug found" above) — the reason the correlation hook's queue
  require is deferred.
- AI provider latency: **not measured** — no real Ollama instance was
  available in this dev environment; every provider call in every test is
  a mocked, near-zero-latency response. `latencyMs` IS captured and stored
  on every real analysis result (`securityAiService.js`'s own `meta.latencyMs`)
  for when a real deployment can report it.
- Queue depth / CPU / memory under real AI load: **not measured**, same
  reason.

## Privacy

**Sent to the AI**: bounded numeric counts (`failedLoginCount`,
`processAnomalyCount`, `uniqueDestinationCount`, etc.), a fixed set of
pre-defined signal labels (e.g. `malicious_ip`, `port_scan` — never a raw
process name, domain, or IP), threat-intel confidence scores (numeric
only), and a `timeWindow`/`scope` label. Every field is validated against
an explicit allowlist in `sanitizer.js` before it can reach a prompt.

**Never sent to the AI**: private message content, WebRTC audio/video,
file contents, passwords, JWTs, refresh tokens, API keys, encryption
keys, cookies, raw process names, raw destination IPs/domains, or any
free-text field a caller might otherwise have included — `sanitizer.js`'s
allowlist drops anything not explicitly recognized, by construction, not
by best-effort filtering.

## Failure Behavior

- **Ollama/provider unavailable**: `securityAiService.analyze()` returns
  `{ ok: false, reason: 'provider_disabled' }` or a network-error reason;
  `AI_PROVIDER_UNAVAILABLE`/`AI_ANALYSIS_FAILED` events recorded; the
  BullMQ worker logs and returns without retrying (a known-unavailable
  provider retried 3x with backoff wastes cycles for no benefit). All
  deterministic security (auth, RBAC, Zero Trust, threat intel, eBPF,
  network intelligence) continues completely unaffected.
- **Model unavailable / malformed response**: caught as `malformed_json`
  or a specific `schema.js` validation-failure reason; never throws past
  `analyze()`'s own try/catch.
- **Timeout**: `AbortSignal.timeout(SECURITY_AI_TIMEOUT_MS)` enforces a
  strict deadline; a timeout counts toward the circuit breaker's tripping
  reasons.
- **Queue overload**: BullMQ's own bounded `attempts: 3` + exponential
  backoff + `removeOnComplete`/`removeOnFail` age-based cleanup prevents
  unbounded job accumulation; correlation itself (collapsing many events
  into one incident before a job is even enqueued) is the primary volume
  control, per the resource-exhaustion tests above.
- **Redis unavailable**: `securityAi/cache.js`'s `getClient()` returns
  `null`, `getCachedAnalysis` returns `null` (a clean miss), `securityAiQueue.js`'s
  `getQueue()` returns `null` (jobs simply aren't enqueued — the
  correlation write to MongoDB still happens, only the AI analysis step
  is skipped) — never a thrown error, matching every other Redis-optional
  module in this codebase.

## Deferred Work

```
Phase 7 → Automated Response (no automated blocking/killing/isolation exists in this phase — confirmed absent)
Phase 8 → Security Command Center (SecurityAiIncidents.jsx is deliberately minimal, not a full command center)
Phase 9 → Production Hardening (real-Ollama evaluation, UDP/DNS-response/TLS-SNI signals from Phase 5's own deferred work, RISK_EXPLANATION automated triggering)
```
