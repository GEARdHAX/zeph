# Call Timeline / Call History

Per-user call participation history — separate from Meeting AI's
meeting-scoped summary (`docs/ZEPH-AI-ARCHITECTURE.md`'s "Meeting-scoped
summaries & authorization" section). Deliberately not an AI feature: no
provider calls, no gateway, no quota — pure connection lifecycle
bookkeeping keyed off the existing mediasoup Socket.IO layer.

## Hierarchy

```
Meeting                        (shared object — already existed)
 ├── MeetingParticipant         one row per (meeting, user) — did they ever join
 ├── MeetingTranscript          ONE canonical AI summary (unrelated system)
 └── CallSession                one row per individual CONNECTION
      └── CallTimelineEvent     CONNECTED / DISCONNECTED / RECONNECTED
```

A user who joins, disconnects, and reconnects to the same meeting gets
**one** `MeetingParticipant` (their participation identity) and **two**
`CallSession`s (each connection period), never a second participant
identity overwriting the first. `Meeting.users` (pre-existing, used for
meeting-summary authorization) is untouched — it already satisfied that
narrower need and nothing required migrating it.

## Connected means actually connected

`CallSession`/`CallTimelineEvent` creation happens in exactly one place:
`mediasoup/index.js`'s `'join'` socket handler, **after** `authorizeMeetingJoin`
has already passed and `socket.join(roomID)` has already succeeded — not
when the frontend merely calls `callManager.join()`. If authorization
fails, or a request is a `'general'`-lobby join rather than a real meeting,
nothing is recorded.

Disconnection is recorded from the single `leaveRoom()` function already
shared by the explicit `'leave'` event AND the `'disconnect'` event
(covering browser/tab close, network drop, and server-side kicks — see
that function's own long-standing comment on why one code path already
handles every disconnect scenario). `disconnectReason` is derived from
which path fired: `'left'` for explicit leave (upgraded to
`'meeting_ended'` when this departure was the meeting's last participant),
`'network'`/`'server'` from Socket.IO's own disconnect reason string for
the `'disconnect'` event path.

## Idempotency

- **Duplicate CONNECTED** (same `socket.id` firing `'join'` twice): guarded
  by looking up an existing ACTIVE `CallSession` for that exact `socketId`
  first — Socket.IO guarantees `socket.id` uniqueness for a connection's
  lifetime, so this can only ever match a genuine duplicate, never a
  different real connection.
- **Duplicate DISCONNECTED** (explicit `'leave'` racing the `'disconnect'`
  event for the same closing socket): the close is a `findOneAndUpdate`
  filtered on `status: 'ACTIVE'` — the second call matches nothing and
  returns `null` rather than double-closing or creating a second
  `DISCONNECTED` event.
- **Reconnect detection**: on `CONNECTED`, checks whether this user has
  *any* prior `CallSession` for this meeting (any status). If so, a
  `RECONNECTED` event is created alongside `CONNECTED`.
- **Duration**: computed server-side inside the same atomic
  `findOneAndUpdate` that closes the session, via a MongoDB aggregation-
  pipeline update (`$subtract`/`$divide` on `connectedAt`/the close
  timestamp) — never trusts a client-provided value, never a separate
  read-then-write race.

## Multi-device / multi-socket

Zeph's mediasoup layer already supports multiple simultaneous sockets per
user in one room (`store.consumerUserIDs[roomId]` is an array of
`socket.id`s, not deduplicated by user). `CallSession` is keyed by
`socketId`, so a second tab/device gets an independent session; closing
one never touches the other.

## Redis usage

`services/callHistoryRedis.js` — `active_call:{meetingId}:{userId}`, a
short-TTL (5 min) heartbeat set on connect and cleared on clean disconnect.
This is **not** the source of truth (Mongo's `CallSession`/
`CallTimelineEvent` are) and is not on the hot path of every lifecycle
tick beyond the one set/clear call. It exists purely as a stale-session
signal for the one failure mode the ordinary socket `'disconnect'` event
cannot cover: the whole Node process dying (crash, OOM, deploy restart)
without running any disconnect handler at all. Best-effort throughout — a
Redis outage never blocks or fails a real connect/disconnect.

**Known limitation**: no reconciliation sweep is implemented yet. A
process crash leaves the affected `CallSession`s `ACTIVE` in Mongo forever
unless a future pass adds a periodic job that cross-checks stale/expired
`active_call:*` keys (or their absence) against still-`ACTIVE` sessions and
closes them with `disconnectReason: 'server'`. Not built in this pass —
would be new background-job infrastructure beyond what was asked for.

## What is deliberately NOT built

- `MIC_MUTED`/`MIC_UNMUTED`/`CAMERA_ON`/`CAMERA_OFF`/`SCREEN_SHARE_STARTED`/
  `SCREEN_SHARE_STOPPED`/`CONNECTION_QUALITY_CHANGED` — reserved in
  `CallTimelineEvent`'s `eventType` enum (zero future schema change to add
  them) but no code path produces them yet. These toggles are pure
  client-side state today (`callManager.js`) with no server round-trip to
  hook into; wiring them would mean adding new socket events beyond this
  pass's scope.
- No raw WebRTC stats, ICE candidates, or connection-quality persistence —
  spec explicitly warns against this (§17).
- No admin-facing cross-user call history view.

## API

- `GET /api/calls/history` — the authenticated user's own history,
  cursor-paginated by `MeetingParticipant.joinedAt`. `userId` comes only
  from the JWT; there is no `userId` request parameter of any kind. An
  optional `?meetingId=` narrows to one meeting (used by the frontend's
  per-meeting timeline popup instead of a separate endpoint).
- `GET /api/meeting/:id/participants` — meeting-scoped, authorized the
  same way as `GET /api/meeting/:id/summary` (participant-history only,
  narrower than live-call-join authorization — a current group member who
  never actually attended this specific meeting is denied). Returns only
  `user`/`joinedAt`/`leftAt` per participant — no session-level detail, no
  technical metadata (IP, device, socketId, WebRTC diagnostics).
- `POST /api/meeting/list` gained a lightweight per-meeting
  `participation: { sessionCount, totalDurationSeconds }` field for the
  CURRENT user only (one batched query across the listed meetings, not
  N+1) — used for the meetings list card's "Joined N times · Xm" line.

## Frontend

- `Panel/components/Meeting.jsx` — an unobtrusive "Your participation: Xm"
  / "Joined N times · Xm" line (not a new button, to avoid card clutter),
  clickable to open the detailed timeline.
- `Panel/components/CallTimelinePopup.jsx` — on-demand fetch (never on the
  list itself), renders the CONNECTED/DISCONNECTED/RECONNECTED sequence
  with server timestamps and duration; no technical WebRTC diagnostics
  shown by default.
