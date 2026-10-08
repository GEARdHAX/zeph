# AI Architecture

AI in Zeph is optional and user-triggered. Core messaging never depends on it.

## 9. AI request flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant API as AI endpoint
  participant GW as AI gateway
  participant Redis
  participant PR as Provider router
  participant LLM as Model provider
  participant DB as MongoDB

  User->>API: ask for summary / translate / draft / rewrite
  API->>API: authenticate and check conversation access
  alt AI not configured
    API-->>User: feature unavailable (chat unaffected)
  end
  API->>API: eligibility rules (enough messages?)
  API->>DB: stored summary still fresh?
  alt reusable result exists
    DB-->>User: cached summary
  end
  API->>API: build bounded context (token budget)
  API->>GW: governed request
  GW->>Redis: per-user, per-IP and global quota
  alt quota exceeded
    GW-->>User: rate-limited with retry hint
  end
  GW->>Redis: take dedup lock for identical work
  GW->>PR: generate (with timeout)
  PR->>LLM: primary provider
  alt provider failing (breaker open)
    PR->>LLM: fallback provider if configured
  end
  LLM-->>PR: text
  PR-->>GW: text + provider used
  GW->>GW: validate output
  GW->>DB: persist summary where applicable
  GW-->>User: result
```

**Cloud vs self-hosted.** Gemini and Groq are cloud providers: the conversation text sent for a request leaves the deployment. Ollama is a self-hosted option that keeps it local. With the provider set to none (the default) every AI endpoint reports unavailable and the rest of the product is unchanged.

**Fallback, precisely.** When the primary is Gemini and a Groq key is configured, Gemini failures fall back to Groq, and a per-provider circuit breaker skips an unhealthy provider for a cooldown period. Groq-only and Ollama-only setups have no fallback; a failure returns "unavailable".

**Why this design?** Everything that costs money or can be abused sits in one governed gateway, so individual features (summary, translate, draft) cannot bypass quotas or timeouts. The provider router isolates vendor specifics, which keeps cost, privacy and lock-in decisions configurable.

---

## 10. Cost and governance controls

```mermaid
flowchart TD
  Req["AI request"] --> Elig{"Eligible?<br/>enough content,<br/>feature enabled"}
  Elig -- "no" --> R1["Rejected<br/>no model call"]
  Elig -- "yes" --> Cache{"Fresh stored<br/>result?"}
  Cache -- "yes" --> Serve["Serve stored result<br/>no model call"]
  Cache -- "no" --> UQ{"Per-user quota<br/>and concurrency"}
  UQ -- "over" --> R2["Rejected with retry hint"]
  UQ -- "ok" --> GQ{"Per-IP and global<br/>concurrency"}
  GQ -- "over" --> R2
  GQ -- "ok" --> Dedup{"Identical request<br/>already running?"}
  Dedup -- "yes" --> Wait["Join the existing job<br/>one model call total"]
  Dedup -- "no" --> Ctx["Bounded context<br/>token budget"]
  Ctx --> Call["Provider call<br/>hard timeout<br/>circuit breaker"]
  Call --> Val{"Output valid?"}
  Val -- "no" --> R3["Discard"]
  Val -- "yes" --> Store["Store result for reuse"]
```

| Control | Effect |
|---|---|
| Eligibility minimums | Avoids paying to summarize trivial conversations |
| Stored summaries | Repeated requests are served without a model call until the conversation changes enough |
| Per-user / per-IP / global limits | Bounds spend from any one account, address, or a burst |
| Dedup lock | Concurrent identical requests collapse into a single model call |
| Token budget | Caps input size per call |
| Timeout + circuit breaker | A slow or failing provider cannot stall users or burn retries |
| Explicit user action | Nothing runs in the background without a user asking |

Measured against a mock model (not a real provider): 10 identical concurrent summary requests produced 1 model call. See [`../ZEPH-AI-ARCHITECTURE.md`](../ZEPH-AI-ARCHITECTURE.md).

**Why this design?** An LLM call is the one place where a bug or a malicious user can turn directly into a bill. Putting every control before the provider call, and making AI explicit and optional, keeps cost predictable and the product usable when AI is off.

---

## 13. Meeting AI pipeline

```mermaid
flowchart LR
  subgraph Live["Live call (transport only)"]
    Call["Participants<br/>Cloudflare Realtime"]
  end

  subgraph Post["After the call (asynchronous)"]
    Rec["Audio recording<br/>uploaded by the client"]
    Ask["Participant requests<br/>a meeting summary"]
    Job["Queued job<br/>BullMQ"]
    T["Transcribe audio"]
    S["Summarize transcript"]
    Store[("Stored summary<br/>MongoDB")]
  end

  Call -. "recording made on the client" .-> Rec
  Rec --> Ask --> Job --> T --> S --> Store
  Store --> User["Participants read the summary"]
```

There is **no realtime AI transcription** during a call. Recording and summarization happen after the call, only when a participant asks, and a failure leaves the meeting itself unaffected.

**Why this design?** Keeping AI out of the live media path means it cannot affect call quality or cost, and queueing it with retries makes slow transcription a background concern.
