# System Overview

High-level view of the production components and what each one is responsible for. Every node below is a service Zeph actually uses today.

## 1. System architecture

```mermaid
flowchart LR
  Browser["Browser<br/>React SPA"]

  subgraph Hosting["Application hosting"]
    Vercel["Vercel<br/>static frontend"]
    API["Backend API<br/>Express + Socket.IO<br/>(Render)"]
    Workers["BullMQ workers<br/>(same backend deployment)"]
  end

  subgraph Data["Data"]
    Mongo[("MongoDB Atlas")]
    Redis[("Redis<br/>(Upstash)")]
  end

  subgraph Cloudflare["Cloudflare"]
    R2[("R2 object storage")]
    Worker["CDN Worker<br/>signed URLs"]
    RT["Realtime SFU<br/>calls"]
  end

  subgraph AI["AI providers (optional)"]
    Router["Provider router"]
    Cloud["Gemini / Groq<br/>cloud"]
    Ollama["Ollama<br/>self-hosted"]
  end

  Mail["Mail provider"]

  Browser -- "HTTPS" --> Vercel
  Browser -- "HTTPS REST" --> API
  Browser <-- "WebSocket<br/>Socket.IO" --> API
  Browser -- "signed upload<br/>HTTPS" --> R2
  Browser -- "signed link<br/>HTTPS" --> Worker
  Browser <-- "WebRTC" --> RT

  API --> Mongo
  API <-- "adapter, limits,<br/>cache, queues" --> Redis
  API -- "signed requests" --> R2
  API -- "session control<br/>HTTPS" --> RT
  API -- "HTTPS" --> Router
  Router --> Cloud
  Router --> Ollama
  API --> Mail
  Workers <--> Redis
  Workers --> Mongo
  Workers --> R2
  Worker -- "binding" --> R2
```

**Legend**

| Arrow | Meaning |
|---|---|
| HTTPS REST | Request/response API calls (auth, messages, uploads, AI) |
| WebSocket / Socket.IO | Realtime events pushed to the browser |
| signed upload / signed link | Browser talks to storage or the CDN Worker using short-lived, server-signed requests; it never holds storage credentials |
| WebRTC | Call media flows between the browser and the Cloudflare SFU; Zeph's backend only controls sessions |
| adapter, limits, cache, queues | The four jobs Redis does (see diagram 14) |

**Not shown because it is not active / not implemented:** end-to-end encryption (design only), edge caching of media (needs the domain on Cloudflare DNS), and the self-hosted mediasoup call engine (an alternative behind a switch, not the production path).

**Why this design?** The API server is kept off the hot path for heavy bytes: uploads go straight to object storage and downloads come through a Worker, so the application server's bandwidth and memory are spent on authorization and business logic. Redis holds only coordination state, never the authoritative record. Optional services (AI, mail, object storage) degrade cleanly when unconfigured, so the core chat product has few hard dependencies.

---

## 14. Data responsibilities

```mermaid
flowchart TB
  subgraph Mongo["MongoDB — system of record"]
    M1["Users, sessions, passkeys"]
    M2["Conversations, groups, members"]
    M3["Messages, receipts"]
    M4["Media metadata"]
    M5["AI summaries, meetings, transcripts"]
    M6["Security events, call history"]
  end

  subgraph Redis["Redis — coordination, not truth"]
    R1["Socket.IO adapter<br/>cross-instance events"]
    R2["Rate-limit buckets"]
    R3["AI quotas and dedup locks"]
    R4["Caches"]
    R5["BullMQ job state"]
  end

  subgraph R2S["Cloudflare R2 — bytes"]
    O1["Uploaded files and thumbnails"]
    O2["Avatars"]
  end

  Mongo -. "metadata points to" .-> R2S
```

| System | Authoritative for | Loss impact |
|---|---|---|
| MongoDB | All durable application data | Data loss (backups are a planned improvement) |
| Redis | Nothing durable: counters, locks, queue state, cache, adapter pub/sub | Rate limiting denies requests (fails closed); queued jobs wait; sockets fall back to single-instance behaviour |
| R2 | The file bytes only | Media unavailable; metadata remains in MongoDB |

**Why this design?** Keeping a single system of record (MongoDB) makes consistency simple: Redis can be flushed or lost without losing a message, and a media file's lifecycle is driven by its MongoDB record.
