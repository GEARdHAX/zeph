# Messaging Flow

How a message gets from one user to another, and how Zeph recovers when the network misbehaves.

Terminology: Zeph provides **idempotent message persistence** and **reliable recovery across reconnects**. It does not claim exactly-once network delivery.

## 2. End-to-end message flow

```mermaid
sequenceDiagram
  autonumber
  actor Sender
  participant UI as Sender UI
  participant API as REST API
  participant DB as MongoDB
  participant IO as Socket.IO
  actor Recipient

  Sender->>UI: types and sends
  UI->>UI: optimistic bubble<br/>+ client-generated ID
  UI->>API: POST /api/message (clientID)
  API->>API: authenticate (session valid?)
  API->>API: authorize (room member,<br/>role, block and privacy rules)
  API->>API: validate and sanitize content
  API->>DB: insert message
  alt first time this clientID is seen
    DB-->>API: stored
  else duplicate (unique index on room, author, clientID)
    DB-->>API: conflict
    API->>DB: load the existing message
  end
  API-->>UI: 200 with the stored message
  UI->>UI: replace temporary ID with server ID
  API->>IO: emit message-in to each member's user room
  IO-->>Recipient: message-in (via Redis adapter if on another instance)
  Recipient->>IO: message-delivered
  IO-->>Sender: delivery update
  Recipient->>API: mark read
  API->>DB: record read state
  API->>IO: emit read update
  IO-->>Sender: read receipt
```

### Failure path

```mermaid
sequenceDiagram
  autonumber
  participant UI as Sender UI
  participant OB as IndexedDB outbox
  participant API as REST API
  participant DB as MongoDB
  participant IO as Socket.IO

  UI->>OB: save message with clientID
  UI->>API: POST /api/message
  Note over UI,API: network fails or times out
  UI->>UI: retry with exponential backoff
  Note over UI: still offline: message stays in outbox
  IO-->>UI: socket reconnects and re-authenticates
  UI->>OB: flush pending messages
  UI->>API: POST /api/message (same clientID)
  API->>DB: insert
  DB-->>API: stored, or duplicate detected
  API-->>UI: the one stored message
  UI->>OB: remove from outbox
  UI->>API: POST /messages/sync (last known message)
  API-->>UI: all newer messages (bounded batch)
```

**Why this design?** Zeph persists messages over HTTP rather than treating Socket.IO as the source of truth. A client-generated ID combined with a database uniqueness constraint makes retries idempotent, so the same message sent twice is stored once. Socket.IO is responsible only for realtime propagation. This separates durable state from live delivery and lets the client recover anything it missed by asking the server for messages newer than the last one it knows.

---

## 3. Unreliable-network flow

```mermaid
flowchart TD
  Send["User sends message<br/>(client ID assigned)"] --> Online{"Network OK?"}
  Online -- "yes" --> Post["POST to server"]
  Online -- "no / request fails" --> Queue["Durable queue<br/>IndexedDB outbox"]
  Post --> Ok{"Success?"}
  Ok -- "yes" --> Done["Server ID replaces<br/>temporary ID"]
  Ok -- "network error" --> Queue
  Ok -- "4xx rejected" --> Surface["Show error<br/>do not retry"]
  Queue --> Retry["Retry with<br/>exponential backoff"]
  Retry --> Back{"Back online?"}
  Back -- "not yet" --> Retry
  Back -- "yes, socket reconnects" --> Resend["Resend with the SAME client ID"]
  Resend --> Unique{"Server unique<br/>constraint"}
  Unique -- "new" --> Store["Store message"]
  Unique -- "already stored" --> Existing["Return existing message<br/>no duplicate created"]
  Store --> Clear["Remove from outbox"]
  Existing --> Clear
  Clear --> Sync["Sync: fetch messages newer<br/>than the last known one"]
  Sync --> Merge["Merge into the conversation,<br/>skipping messages already present"]
```

**Engineering properties**

| Property | How it is achieved |
|---|---|
| Durable client-side queue | Unsent messages are written to IndexedDB, so they survive tab reloads and crashes |
| Retry | Exponential backoff for transient failures; client errors (4xx) are surfaced instead of retried |
| Idempotency | Same client ID on every attempt plus a database uniqueness constraint |
| Reconnect recovery | The outbox is flushed every time the socket authenticates |
| Synchronization | After reconnect the client requests everything newer than its last known message and merges without duplicating |

**Scope.** The outbox holds text messages. Media uploads are not queued offline.

**Why this design?** Mobile connections fail in the middle of requests, so a client often cannot tell whether the server received a message. Making the write idempotent turns that ambiguity into a safe retry instead of a data problem, and a durable queue means a user closing the tab does not lose what they typed.
