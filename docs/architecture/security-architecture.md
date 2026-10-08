# Security Architecture

Conceptual view only. Operational and vulnerability details are kept in internal documentation.

## 4. Authentication and authorization

### HTTP requests

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant API as Backend
  participant DB as MongoDB

  U->>API: sign in (password or passkey)
  API->>API: verify credential
  API->>DB: create a session for this device
  API-->>U: signed token bound to the session
  U->>API: authenticated request
  API->>API: verify token
  API->>DB: session exists and is not revoked?<br/>account active?
  alt revoked or inactive
    API-->>U: 401
  else valid
    API->>API: resource authorization<br/>(membership, role, privacy rules)
    alt allowed
      API-->>U: result
    else not allowed
      API-->>U: 403 or 404
    end
  end
```

### Sensitive actions

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant API as Backend
  participant RE as Risk engine

  U->>API: sensitive request (e.g. change password)
  API->>RE: evaluate session and context
  alt ALLOW
    RE-->>API: allow
    API-->>U: continue
  else STEP_UP
    RE-->>API: step-up required
    API-->>U: 428 — verify again
    U->>API: additional authentication
    API-->>U: retry succeeds
  else DENY
    RE-->>API: deny
    API-->>U: 403
  else engine failure
    API-->>U: refused (fails closed)
  end
  Note over API: decisions are recorded as security events
```

### Socket connections

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant IO as Socket server
  participant DB as MongoDB

  C->>IO: connect
  IO->>IO: start authentication deadline
  C->>IO: authenticate (token)
  IO->>IO: validate token
  IO->>DB: session revoked?
  alt invalid, revoked, or deadline passed
    IO-->>C: disconnect
  else valid
    IO->>IO: join private user room
    IO-->>C: authenticated
  end
```

**Why this design?** Tokens alone cannot be revoked, so every request and every socket also checks a server-side session record; signing a device out takes effect immediately. Sensitive actions go through a separate risk decision rather than a flat role check, and authorization is evaluated per resource rather than assumed from the token.

---

## 5. Rate limiting

```mermaid
flowchart TD
  Req["Incoming request"] --> Pol["Select policy for the route<br/>(auth, API, AI, messages, ...)"]
  Pol --> Key["Identify caller<br/>(user or IP)"]
  Key --> Redis{"Redis token bucket<br/>(atomic script)"}
  Redis -- "tokens available" --> Next["Request continues"]
  Redis -- "empty" --> Rej["429 Too Many Requests<br/>+ retry hint"]
  Rej --> Ev["Security event recorded"]
  Redis -- "Redis unavailable" --> Closed["Fail closed:<br/>request rejected"]
  Closed --> Log["Logged for operators"]
```

Because the counters live in Redis and are updated atomically, the limit applies across every backend instance, unlike a per-process in-memory limiter. It also means a Redis outage rejects traffic instead of silently removing protection.

Scale claims: none. The limiter's behaviour is covered by tests; no multi-instance benchmark of it has been published.

**Why this design?** Fail-closed trades availability for safety during a Redis outage, which is the right default for authentication and AI endpoints, where unlimited traffic is worse than a short interruption.

---

## 19. Trust boundaries

```mermaid
flowchart TD
  subgraph Untrusted["UNTRUSTED"]
    Client["Browser and client claims<br/>file type, size, user IDs, thumbnails"]
    AIin["AI inputs and outputs<br/>user text, model responses"]
  end

  Client --> Authn["Authentication<br/>who is this?"]
  Authn --> Authz["Authorization<br/>may they do this to this resource?"]
  Authz --> Val["Validation and sanitization"]
  AIin --> Val
  Val --> Logic["Business logic"]

  subgraph Trusted["TRUSTED BACKEND"]
    Logic
  end

  Logic --> Data[("Database")]
  Logic --> Store[("Object storage")]
```

| Input | Treatment |
|---|---|
| Upload metadata (type, size, name) | Never trusted; derived from policy and re-verified against the stored object |
| Client-supplied identifiers and ownership claims | Ownership checked against the authenticated user on the server |
| Thumbnail / poster references | Validated against what that user actually uploaded |
| AI input and model output | Treated as untrusted text: bounded in size, output validated, user-specific access checks before any conversation text is gathered |
| Transport | HTTPS / WSS. Zeph is **not** end-to-end encrypted |

**Why this design?** Every check that matters is made on the server, after authentication, against server-side state. The client is a convenience layer, not a security boundary.
