# ZEPH Phase 10 — Engineering & Business-Logic Audit Findings

Consolidated findings from two read-only audits run against commit
`af68a25` (2026-09-29): a technical/architecture audit (stack, patterns,
security, reliability, testing, scalability) and a business-logic/domain
audit (product rules, domain model, authorization consistency, product
scope). Both audits read the actual code for every claim; nothing below
is asserted without a `file:line` citation. Status tags match the
convention used elsewhere in `docs/`: **IMPLEMENTED**, **PARTIAL**,
**WEAK IMPLEMENTATION**, **PLANNED**, **NOT VERIFIED IN CODEBASE**,
**TEST-VERIFIED**. Two items were proof-of-concept verified by running
code against the repo's own test harness — those are marked **PoC-VERIFIED**.

Nothing in this document was run against production. "Not verified" items
were established by reading code, not by exploiting a live system.

---

## 1. Fixed (as of this report)

### G-C1 — Account takeover via NoSQL operator injection — FIXED
**Severity: CRITICAL — PoC-VERIFIED**
`backend/src/routes/auth/change.js:62` passed the request body's `code`
field straight into `AuthCode.findOne({ code, user, valid: true })`.
Sending `{"code":{"$ne":"x"}}` as JSON bypassed the check entirely,
allowing account takeover from just an email address (PoC reproduced
against the repo's own in-memory Mongo test harness: 200 OK login as the
victim with an attacker-chosen password).
**Fix applied**: `code`, `email`, and `password` are now rejected unless
they are plain strings, closing the operator-injection path before the
query runs.

### G-C2 — One-packet authenticated DoS — FIXED
**Severity: CRITICAL — PoC-VERIFIED**
`backend/src/events/status.js:6` destructured the socket payload
(`let { status } = data`) with no guard. `socket.emit('status')` with no
payload threw a synchronous `TypeError`, and with no `uncaughtException`
handler anywhere in the process, this crashed the entire backend from a
single authenticated client.
**Fix applied**: guarded the destructure (`data || {}`), and added a
process-level `uncaughtException` handler in `backend/index.js` so no
other unguarded handler can take the process down the same way.

---

## 2. Critical / High — not yet fixed

### N1 — Meeting summary reachable without ever attending
**Severity: HIGH**
A current group member passes `isAuthorizedForMeeting`
(`authorization/meetingInvitePolicy.js:15-25`), so they can create a
meeting invite and accept it themselves. Accepting only performs
`$addToSet` on `Meeting.users` (`routes/meetings/invites/accept.js:110`).
The summary routes authorize purely on `Meeting.users`
(`routes/meeting/get-summary.js:22-27`), so this defeats the intended
"a group member who never joined is denied" rule — a rule that is
TEST-VERIFIED (`test/meetingAi.test.js:373`) through a different path
than this one.
**Root cause**: authorization reads `Meeting.users` (an append-only list
that invite-acceptance can write) instead of `MeetingParticipant` (which
only the media server writes, after a real socket join).
**Fix direction**: authorize meeting-summary access from
`MeetingParticipant` existence, not `Meeting.users`.

### N2 — Invites remain acceptable after the meeting has ended
**Severity: HIGH**
Neither invite creation nor invite acceptance checks `Meeting.endedAt`.
An invite still inside its expiry window (up to 7 days) lets a stranger
become a summary reader after the fact, and they also count toward
`minParticipants` for AI-summary eligibility.
**Evidence**: `routes/meetings/invites/create.js:26-45`,
`accept.js:31-110`, `ai/eligibility.js:80-88` (`participantCount =
meeting.users.length`).
**Fix direction**: reject `accept` once `Meeting.endedAt` is set; count
eligibility from `MeetingParticipant`, not `Meeting.users`.

### N4 — Any authenticated socket can end someone else's meeting
**Severity: HIGH** (only reachable when `MEDIASOUP_ENABLED=true`,
currently off in production per D-047)
The `leave` socket handler trusts a client-supplied `data.roomID`.
`leaveRoom` runs `consumerUserIDs[roomID].splice(indexOf(socket.id), 1)`;
if the socket isn't actually in that room's list, `indexOf` returns `-1`
and the splice removes the room's **last** entry instead. If that empties
the list, `endedAt` gets set on a meeting the caller was never part of.
**Evidence**: `mediasoup/index.js:377-380, 468-469, 479-481, 499`.
**Fix direction**: validate `roomID` against the socket's own tracked
room before indexing into `consumerUserIDs`.

### N5 — Removed group members can rejoin group calls
**Severity: HIGH** (same production flag caveat as N4)
`authorizeMeetingJoin` checks `Meeting.users` (append-only, never
shrinks) *before* the live group-membership check, so a member removed
from the group after joining a call once can still rejoin. A code
comment claims the opposite ordering.
**Evidence**: `mediasoup/index.js:113-115` (claim) vs `:126` (actual
order).

### N17 — Any user can ring any other user, bypassing blocks
**Severity: MEDIUM-HIGH**
`/meeting/add` sends a `call` socket event to an arbitrary `userID` and
checks only the admin-privacy boundary — no block check, no shared-room
check. `answer` and `close` have the same gap.
**Evidence**: `routes/meeting/add.js:12-37`, `answer.js`, `close.js`.
**Impact**: a blocked user can still make the blocker's phone ring.

---

## 3. Medium

### N3 — The canonical meeting summary is one participant's mic, and any participant can overwrite it
The recorder captures only the local microphone
(`frontend/src/features/Meeting/components/MeetingRecorder.jsx:7-13`).
Every `/summarize` call with a `mediaId` re-transcribes and replaces the
transcript, then re-summarizes (`ai/meetingTranscriptService.js:65-73,
104-107`). "One summary per meeting" is enforced at the database level
(a unique index on `MeetingTranscript.meeting`) but not at the content
level — the most recent uploader wins.

### N6 — AI features bypass Private Vault, "delete for me," and delete-cutoff rules
AI routes (`routes/ai/summarize.js:45-46`, `draft-reply.js:37`,
`topics.js:38`, `title.js:38`) check only `room.people` and never filter
by vault lock, `deletedBefore`, or `deletedFor`. Message search
(`routes/messages/search.js:66-71`) *does* enforce the vault — the
privacy model is inconsistent across features. A room's AI summary can
resurface content one member deleted from their own view.

### N7 — "Delete for everyone" doesn't invalidate the cached AI summary or the referenced media
`routes/message-delete.js:86-89` nulls the message's `content` and
`file`, but not `media`. `routes/media.js:15-16` authorizes media access
by finding a message that references it — since `media` survives the
tombstone, the file stays downloadable. The cached `ConversationSummary`
is also never invalidated when a message it was built from is retracted.

### N9 — Group and friend invite expiry relies only on MongoDB's TTL sweep
Only meeting invites check `expiresAt` inside the query itself
(`meetings/invites/accept.js:31-40`, explicit comment at
`models/MeetingInvite.js:23-28`). Group and friend invites
(`routes/group/invites/join.js:21-29`, `friends/invites/accept.js:15-17`)
rely solely on the TTL monitor, which runs roughly once a minute —
so an expired link stays usable for up to that long.

### N10 — A plain group MEMBER can undo an admin's removal
`ADD_MEMBER` is granted to every role (`authorization/groupPolicy.js:48`),
and `members-add.js:23-40,51-60` upserts REMOVED or LEFT rows back to
ACTIVE — only BANNED is blocked. There is also no consent, block, or
friendship check on the person being added.
**Impact**: breaks the role hierarchy (an admin's removal can be
silently undone by any member), and is a forced-group-add spam vector.

### N11 — Account deletion can leave a group without an owner
`utils/cleanupDeletedUser.js:26-30` sets `active: false` without changing
`status` and never transfers ownership, even though `group/leave.js`
forbids owners from leaving normally. Deleting an owner's account leaves
the group with nobody holding `EDIT_GROUP`/`MANAGE_ADMINS`. This also
breaks the model's own stated invariant that `GroupMember.active` always
equals `status === 'ACTIVE'` (`models/GroupMember.js:18-22`).

### N12 — Username login is case-sensitive; registration is not
`routes/login.js:17,48-49` lowercases the input and queries the raw
`username` field, while `routes/register.js:37` stores the
original-case username. A user who registers as "Alice" can log in with
their email but not by typing "Alice" — only whatever exact case they
originally registered with matches the lowercased comparison. The model
has a normalized field (`usernameNormalized`, `models/User.js:19`) that
login should be using instead.

### N13 — Suspension doesn't disconnect live sockets
Socket authentication checks session revocation but never
`accountStatus` (`init.js:110-134`). `admin/user-suspend.js:59-61` only
emits an `account-suspended` event and relies on the client to act on it
— a modified or non-listening client keeps receiving live pushes after
suspension. Session revocation (`sessions/revoke.js:99-104`) *does*
disconnect sockets for comparison — suspension should use the same
mechanism.

### N14 — The Private Vault unlock token doubles as a bearer login token
The vault token is signed with the same secret and carries only
`{id, purpose}` (`vault/vaultToken.js:12-15`). The passport strategy
accepts any token with an `id` and treats a token with no `deviceId` as
a legacy session that skips revocation checks (`init.js:303-338`,
`config.js:144`) — so a 10-minute vault-unlock token can function as a
general bearer credential.

### N15 — Media access check does a full collection scan
`routes/media.js:16` runs `Message.findOne({media})` with no supporting
index (`models/Message.js` has no `{media:1}` index). Every media view
costs time proportional to total message count in the room.

### N18 — Meeting transcription is unmetered
`ai/meetingTranscriptService.js:51-54` bypasses the AI gateway's quota
system entirely, and the route sits outside the `/api/ai` rate limiter
(`routes/index.js:294-298`). The only protection is a 3-minute in-flight
status check. Speech-to-text — the most expensive AI operation in the
system — is the one operation that isn't cost-governed.

### N19 — All background AI jobs share one synthetic rate-limit bucket
Queued chat summaries charge the IP bucket `'queue'`, and every meeting
summary charges `'meeting'` (`queues/aiWorker.js:30`,
`ai/meetingTranscriptService.js:182`), against the shared
`perIpPerMinute` default of 20 (`ai/quota.js:57,89`). This is effectively
one global cap of 20 successful background AI jobs per minute, shared by
every user.

### N20 — Meeting list has no index and no limit cap
`routes/meeting/list.js:8-10,15-30` runs an `$or` across
users/caller/callee with a client-supplied `limit`, against a `Meeting`
model with zero declared indexes — a full collection scan on every call
to load meeting history, plus an uncapped-payload risk.

---

## 4. Low

- **N8** — Global message search is a dead code path: it filters
  `disabledAt: {$exists:false}`, but `Room.disabledAt` always defaults to
  `null` on both creation paths, so the filter never matches anything.
  The UI only calls per-room search, so this is latent, not user-visible.
  `routes/messages/search.js:77`, `models/Room.js:22`.
- **N16** — A server crash leaves `CallSession` rows stuck `ACTIVE`
  forever (blocking future invite-accepts with `409 ALREADY_IN_MEETING`)
  and `Meeting.endedAt` never gets set. A Redis heartbeat key
  (`active_call:{meeting}:{user}`) exists but nothing ever reads it —
  there is no reconciliation sweep. `services/callHistoryRedis.js:1-8,
  53-68`.
- `message-read.js` accepts an unbounded `messageIDs` array.
- The `status` socket event lets a client set any arbitrary presence
  string.
- `message.js` doesn't validate `mediaID`/`fileID` ownership before
  attaching them to a sent message.
- `Meeting` has no indexes at all (also see N20).
- `Message` has no index on `media` (also see N15).
- `Email` has no index on `{sent, attempts}` despite being polled every
  5 seconds.
- Group privacy modes (`Room.privacy`: PUBLIC/PRIVATE/INVITE_ONLY) are
  stored and displayed but never enforced anywhere in join-request logic.
- No group size cap exists anywhere in the codebase.
- Reports can be created even when the two users have blocked each
  other (deliberate, but worth confirming is still wanted).
- Report review has no state-transition guard — any resolved status can
  be overwritten by any privileged user, last-write-wins.
- Deleted users' messages, media, sessions, reports, and call records
  are all retained indefinitely — there is no data-erasure path beyond
  the hard-deleted `User` row itself (no GDPR-style right-to-erasure).
- `styled-components` and `zod` are installed but have zero imports.
- Docker image pins Node 18 + yarn.lock while CI and `engines` expect
  Node 20 + package-lock.json — the two lockfiles can drift.
- Graceful shutdown's close list omits two of the ~10 Redis clients
  (the AI client and the call-history client).
- No automated MongoDB backups exist.

---

## 5. Structural / architectural notes (not bugs, but worth documenting)

- **Presence is O(N²) and single-process.** `store.onlineUsers` is an
  in-memory `Map`; every connect/disconnect/call-join/call-leave
  broadcasts the full filtered online-user list to every connected
  socket (`presence.js:21-59`). It is also platform-wide rather than
  scoped to contacts — every client learns every other non-admin,
  non-blocked user's online status.
- **HTTP rate limiting is entirely in-memory**, per process. Limits
  reset on every deploy and do not combine across instances if the app
  is ever horizontally scaled.
- **Mediasoup runs a single worker and single router**; the process
  exits if the worker dies. Capacity has never been load-tested.
- **No tenant/organization concept exists anywhere in the schema.**
  `User`, `Room`, `GroupMember`, and `Meeting` are all user- or
  room-scoped only. Multi-tenancy, SSO/SAML/SCIM, and org-level billing
  would all require new models and a query-scoping layer across roughly
  100 route files — this is real design work, not a quick add.
- **No billing/monetization exists.** The existing per-user Redis AI
  quota keys (`ai/quota.js`) are a clean attachment point for a future
  paid tier; meeting transcription (N18) and the shared per-room AI
  summary cost-sharing model would need separate design work first.

---

## 6. What these audits did not verify

- Neither audit ran the app or the test suites; findings come from
  reading code, with two exceptions (G-C1, G-C2) that were reproduced
  against the repo's own in-memory-Mongo test harness from a scratch
  directory outside the repo.
- Not read in full: most `routes/group/*`, `routes/users/*`,
  `passkey/*`, `vault-webauthn/*`, the eBPF sensor, network-intel and
  threat-intel subsystems, and several AI routes (`translate.js`,
  `rewrite.js`).
- Production configuration (whether Redis and mediasoup are enabled,
  which AI provider is active) was not visible from the code — anything
  stated about production relies on `DECISIONS.md`/`docs/` documentation
  of intent, not a live check.
- BullMQ semantics referenced (e.g. `job.remove()` on an active job) are
  stated from general BullMQ knowledge, not verified against a real
  Redis-backed queue.

---

*Source: two read-only audits performed 2026-09-29 against commit
`af68a25`. See also `docs/PHASE9-SECURITY-REPORT.md` and
`docs/PHASE8-CAPACITY-REPORT.md` for the prior-phase findings this audit
builds on.*
