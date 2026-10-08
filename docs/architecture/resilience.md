# Resilience and Performance

## 15. Background jobs

```mermaid
flowchart LR
  API["API request"] --> Add["Enqueue job"]
  Add --> Q[("BullMQ<br/>state in Redis")]
  Q --> W["Worker process<br/>(runs inside the backend deployment)"]
  W --> Proc{"Job processor"}
  Proc -- "success" --> Done["Completed<br/>kept briefly then pruned"]
  Proc -- "failure" --> Retry{"Attempts left?"}
  Retry -- "yes" --> Back["Retry with backoff"] --> Q
  Retry -- "no" --> Failed["Marked failed<br/>kept briefly for inspection"]
```

| Queue | Purpose |
|---|---|
| Media cleanup | Remove stored files after a message or conversation is deleted |
| Group cleanup | Purge a deleted group's data after a delay |
| AI summary | Conversation summaries |
| Meeting AI | Transcribe and summarize meetings |
| Security analysis | Advisory AI analysis of security events |

Jobs are retried a limited number of times with backoff and are pruned after a retention window. There is no separate dead-letter queue; exhausted jobs remain visible as failed for a limited time. Without Redis, media cleanup runs in-process on a best-effort basis and other queues are inactive.

---

## 18. Behaviour when dependencies fail

```mermaid
flowchart TD
  F1["Redis unavailable"] --> R1["Rate limiter fails closed<br/>requests rejected, logged"]
  F1 --> R1b["Sockets fall back to single-instance delivery"]
  F2["AI provider fails"] --> R2["Circuit breaker opens"]
  R2 --> R2a["Fallback provider if configured<br/>otherwise feature unavailable"]
  R2a --> R2b["Core messaging unaffected"]
  F3["Network drops on the client"] --> R3["Outbox keeps the message<br/>retry with backoff"]
  R3 --> R3b["Reconnect then resend then sync"]
  F4["Storage delete fails"] --> R4["BullMQ retries the cleanup job<br/>user's delete already succeeded"]
  F5["Socket disconnects"] --> R5["Client reconnects and re-authenticates"]
  R5 --> R5b["Outbox flush + message sync"]
  F6["Call usage limit reached"] --> R6["New calls refused<br/>chat unaffected"]
  F7["Optional service not configured<br/>AI, mail, object storage"] --> R7["Feature off or local fallback<br/>core product still works"]
```

Every arrow above corresponds to implemented behaviour. Things Zeph does **not** yet do: automatic database failover, automated backups, cross-instance presence, metrics and tracing.

---

## 20. How engineering decisions map to performance

```mermaid
flowchart LR
  A["Large conversation"] --> A1["Cursor pagination"] --> A2["Few documents examined per page<br/>measured: 50 of 5,000"]
  B["Large media"] --> B1["Direct-to-storage upload"] --> B2["File bytes bypass the API server"]
  C["Heavy screens<br/>admin, editors, viewers, meetings"] --> C1["Lazy-loaded chunks"] --> C2["Lower initial JavaScript"]
  D["Repeat AI requests"] --> D1["Stored summaries + dedup lock"] --> D2["Fewer model calls<br/>measured vs mock: 10 requests to 1 call"]
  E["Flaky connection"] --> E1["Optimistic UI + outbox"] --> E2["Instant feedback, no lost messages"]
  F["Group video calls"] --> F1["Resolution and bitrate caps<br/>participant cap"] --> F2["Bounded bandwidth and cost"]
  G["Untouched video clip"] --> G1["Upload original without re-encoding"] --> G2["No wait proportional to clip length"]
  H["Frequent queries"] --> H1["Database indexes"] --> H2["Measured: full scan of 3,005 docs to 1"]
```

Only measured results are quoted with numbers; the others are design properties. Measurements are from local runs (see the README performance section); no production capacity is claimed.
