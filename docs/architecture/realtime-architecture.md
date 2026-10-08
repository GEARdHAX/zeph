# Realtime Architecture

## 11. Socket.IO across multiple backend instances

```mermaid
flowchart LR
  subgraph ClientsA["Clients"]
    A["Client A"]
    B["Client B"]
  end

  subgraph Instances["Backend instances (horizontal scale-out)"]
    IA["Instance 1<br/>Socket.IO"]
    IB["Instance 2<br/>Socket.IO"]
  end

  Redis[("Redis<br/>pub/sub adapter")]
  Mongo[("MongoDB<br/>messages")]

  A <-- "WebSocket" --> IA
  B <-- "WebSocket" --> IB
  IA <-- "events" --> Redis
  IB <-- "events" --> Redis
  IA -. "HTTP writes persist here" .-> Mongo
  IB -. "HTTP writes persist here" .-> Mongo
```

### Rooms and fan-out

```mermaid
flowchart TD
  Msg["Message saved over HTTP"] --> Members["Look up conversation members<br/>from the database"]
  Members --> Emit["For each member:<br/>emit to that user's private room"]
  Emit --> U1["User room: member 1<br/>(all their devices)"]
  Emit --> U2["User room: member 2"]
  Emit --> U3["User room: member N"]
```

| Concern | Who handles it |
|---|---|
| Durable message storage | HTTP request to the API, written to MongoDB |
| Live propagation to browsers | Socket.IO events emitted after the write |
| Delivering events across instances | Redis adapter (pub/sub only; it does **not** store message history) |
| Who receives an event | Server-side membership lookup; clients cannot subscribe themselves to other people's conversations |
| Socket identity | Client must authenticate shortly after connecting; revoked sessions are refused |

**Current limits (honest scope).** Presence state is kept per backend process and is not yet shared across instances. Without Redis, Socket.IO falls back to single-instance behaviour.

**Why this design?** Each user joins one private room keyed by their own ID. Fan-out is then a loop over trusted, database-derived members, which avoids per-conversation room bookkeeping and removes a class of authorization mistakes. The Redis adapter lets additional instances be added without changing that logic, and because Redis only relays events, losing it never loses messages.
