# DECISIONS — Chattr Engineering Execution Plan

Architecture and design decisions with options considered, rationale, and tradeoffs.
Format: `D-NNN: Title — Date`

---

## D-037: Group architecture 80/20 completion — join requests, ban, slow mode, ownership transfer, audit log — 2026-08-25

**Problem:** A spec for "Chitcx Group Architecture" (roles, membership
lifecycle, join/request system, moderation, slow mode, audit log) described
building a Group+Conversation+Membership system essentially from scratch.
Auditing first (per the spec's own instruction) found the architecture
already ~70% built under D-035 ("Group IS-A Room"): `Room`(isGroup:true) is
the group model, `GroupMember` already has OWNER/ADMIN/MEMBER roles and a
capability table nearly matching the spec verbatim, and a full invite-link
system (`GroupInvite`) shipped earlier the same session. Building the spec
literally would have duplicated all of that under new names. This entry
covers only the genuine gaps found.

**Genuine gaps closed:**
- `GroupMember.status` enum (PENDING/ACTIVE/LEFT/REMOVED/BANNED), additive
  alongside the existing `active` boolean rather than replacing it — every
  one of the ~8 pre-existing routes filtering on `active:true` needed zero
  changes. New/touched routes set both fields together so they never
  disagree (see GroupMember.js's model comment).
- Join-request flow (`group/join-requests/{create,list,approve,deny}.js`) —
  the no-invite discovery path for a PRIVATE group whose id the caller
  already knows. Deliberately distinct from `group/invites/join.js`: an
  invite link IS the approval; a join-request creates a PENDING row an
  ADMIN/OWNER must act on. `GroupMember`'s unique `{group,user}` index means
  a prior LEFT/REMOVED row from the same user must be *upserted over*, not
  treated as a duplicate — only a genuinely non-terminal existing row (a
  real duplicate PENDING request) refuses.
- Ban (`group/members-ban.js`, `Capabilities.BAN_MEMBER`) — distinct from
  remove: `groupPolicy.isBanned()` blocks rejoin via both the join-request
  path and the existing invite-link join. **Found and fixed a real gap
  while wiring this in**: `group/invites/join.js`'s existing atomic upsert
  set `active:true` but never `status`, meaning a BANNED or REMOVED row's
  `status` field would go stale (still `BANNED`) while `active` flipped
  true — same bug existed in `members-add.js`. Both now set `status`
  explicitly alongside `active` in the same write. `members-add.js`'s
  behavior is intentionally left as "an admin's direct add IS allowed to
  override a ban" (a deliberate override, unlike an invite link which never
  overrides one) — the fix is only that `status` now stays consistent with
  `active` afterward, not a behavior change to who can be re-added.
- Ownership transfer (`group/ownership-transfer.js`) — CAS on the actor
  still holding OWNER (a losing racer 409s rather than double-transferring).
  Old owner becomes ADMIN, not demoted further — a deliberate handoff, not
  a removal. `Room.ownerId` (a denormalized cache per Room.js's own comment)
  kept in sync.
- Slow mode — lives in `Room.settings.slowModeSeconds` (the existing Mixed
  field, previously entirely unused), configurable to
  off/5s/10s/30s/1m/5m via `group/update.js`. Enforced in `message.js`
  right after the existing membership/capability check; OWNER/ADMIN bypass
  (a moderator shouldn't be able to lock themselves out mid-incident).
  Frontend: `retryWithBackoff.js` was unconditionally retrying every error
  including a 429 up to 4 times with exponential backoff — harmless for a
  transient network failure, actively wrong for slow mode (guaranteed to
  fail identically on every retry, burning ~7s before the user sees
  anything). Fixed to stop retrying on any 4xx.
- `GroupAuditLog` — new collection, additive to (not a replacement for) the
  existing pino `logger.info`/`logger.warn` calls already in these routes.
  Written inline/synchronously (`.create()`, same fire-and-forget shape as
  the existing logger calls) rather than queued — no BullMQ/Redis exists
  anywhere in this codebase yet (confirmed by grep), and introducing either
  just for this would violate both this spec's and CLAUDE.md's "no new
  infrastructure" constraints. `message-delete.js`'s existing
  author-OR-moderator delete branch (built pre-D-037, this pass didn't know
  it existed until reading the file) now audit-logs only the
  moderator-override path — a user deleting their own message isn't a
  moderation action.

**What was NOT built, deliberately:** a frontend admin console (member
management screen, pending-requests approval queue, ban list, audit log
viewer). No such screen exists for the *existing* group features either
(role change, remove, group settings are all API-only today) — building a
full console for only the newest features while everything else stays
API-only would be an inconsistent, premature frontend investment. Frontend
this pass: the `requestToJoinGroup` action + a slow-mode-aware error toast
in the composer, matching the "backend-complete, minimal frontend hooks"
scope chosen with the user.

**Testing:** `group-join-requests.test.js` (create/approve/deny, duplicate-
request race, banned-user block, non-admin approval rejection, re-request
after LEFT/denial), `group-ban.test.js` (ban blocks both invite-link and
join-request rejoin, role hierarchy, audit log), `group-ownership-
transfer.test.js` (role swap, Room.ownerId sync, non-owner/self/non-member
rejection), `group-slow-mode.test.js` (rapid-send 429, OWNER/ADMIN bypass,
disabled/unset never blocks), `group-audit-log.test.js` (spot-check
settings_changed and message_deleted_by_admin, confirming self-delete is
NOT logged). Full backend suite: 441/441 (29 new), zero regressions.
Frontend: 278/278, zero regressions. Production build passes.

---

## D-036: Every 1:1/group participant showed as "Deleted User" — Mongoose cast bug, not an account-deletion bug — 2026-08-21

**Problem:** Immediately after D-035 shipped, a report came in that a
brand-new, definitely-not-deleted account ("Adarsh Arya") still displayed
as "Deleted User" in the chat header. Direct reproduction (`POST
/api/room/join`, `POST /api/room/get`, `POST /api/rooms/list` against a
real, freshly-created two-person room) showed the HTTP response's
`room.people` array contained bare ObjectId strings — `["68f...", "68f..."]`
— instead of populated `{_id, firstName, ...}` objects, for **every** 1:1
DM and group, independent of account status entirely. The `!other._id`
frontend check (already fixed earlier for a narrower case) was working
exactly as designed — it just had genuinely broken data to work with.

**Root cause:** four routes (`get-room.js`, `list-rooms.js`,
`list-favorites.js`, and originally `join-room.js` before this fix) shared
the same pattern:
```js
room.people = room.people.map((person) => {
  const obj = person.toObject ? person.toObject() : person;
  delete obj.level;
  return obj;
});
```
`room` here is a live Mongoose document, and `Room.people`'s schema path is
typed `[{type: Schema.ObjectId, ref: 'users'}]`. Assigning a plain-object
array back onto that path causes Mongoose to **cast it back down to bare
ObjectIds** per the schema type — the populated data was correctly fetched
and correctly stripped of `level`, then silently discarded the moment it
was written back onto the document, before serialization. Verified
empirically: the exact same `.populate()` query run standalone (no route
wrapper) returned full objects; the same query through the actual route
returned bare id strings. `create-group.js` and `meeting/call.js` never
had this bug because they build a separate plain object rather than
reassigning onto the Mongoose document.

**Decision:** every affected route now builds a fresh plain object
(`{...room.toObject(), people: [...]}`) rather than mutating the live
document's schema-typed field. Fixed in `get-room.js`, `list-rooms.js`,
`list-favorites.js`, and `join-room.js` (which additionally needed this for
its `findMessagesAndEmit` helper's input, not just the final response).

**Why this went undetected:** every existing test asserting on these
routes checked message content, membership, or DB state — none asserted on
the shape of `people` in the actual HTTP response body. New
`backend/test/room-people-population.test.js` closes this gap directly:
each of the four routes gets a test asserting `people[i]._id`/`firstName`
are real values on the wire, not just correct in the in-memory object
before the bug's cast-back-to-ObjectId step silently ran.

**Testing:** 250/250 backend tests passing (4 new), zero regressions.

---

## D-035: DM delete/restore is non-self-reversing; call authorization moves server-side — 2026-08-21

**Problem:** A user reported that after deleting a 1:1 DM, reopening it
still showed the full old history, the other party's account looked
"deleted" even though it wasn't, calling them showed a misleading
"offline" error, and yet new messages still sent/delivered fine. Full audit
traced this to a real defect and a real gap, not what it first looked like:
- `conversation-delete.js` only ever set `ConversationUserState.deletedAt`
  on the deleter's own row (per-user inbox-hide tombstone, Room/Messages
  untouched — this part was already correct/deliberate, see
  `requireVisibleConversation.js`'s own comment). The actual bug:
  `message.js`'s "WhatsApp-like reappearance" logic unconditionally cleared
  `deletedAt` for **every** room member — including the deleter — on any
  new send/receive, silently undoing the delete and resurrecting the full
  pre-delete history the moment either party sent another message.
- `meeting/call.js` had room-membership + admin-boundary checks but **zero**
  block/existence/account-status check — any call could be placed to a
  blocked, deactivated, or hard-deleted account with no server enforcement
  at all; the only thing standing in the way was a client-side
  `onlineUsers` array lookup (pure UX, not authorization).
- No caching bug existed anywhere (confirmed by exhaustive grep — no
  localStorage use for messages/conversations, no message-pagination
  cache, `Conversation/index.jsx` always fetches fresh on open).

**Decision:**
- `ConversationUserState` gets a second timestamp, `deletedBefore` —
  distinct from `deletedAt`. Delete sets both to "now"; a subsequent
  restore-by-new-activity clears `deletedAt` (conversation reappears in the
  inbox) but **never** `deletedBefore` (old messages stay hidden from that
  user specifically, forever, until their next delete advances the cursor
  again). `join-room.js`/`more-messages.js`/`sync-messages.js` all filter
  returned messages against the caller's own `deletedBefore`, mirroring the
  existing per-message `deletedFor` filter already in these exact files.
- `User` gets a reserved `accountStatus` enum (`ACTIVE`/`DEACTIVATED`/
  `DELETED`), default `ACTIVE`. Only `ACTIVE` is meaningfully used today (no
  self-service deactivation feature exists yet — `DEACTIVATED` is
  schema-only groundwork so that future feature won't need a second
  migration). `message.js`'s existing 1:1 send-authorization block now also
  404s with `reason:'recipient_unavailable'` for a nonexistent/hard-deleted
  recipient, or 403s the same reason for a `DEACTIVATED` one — both mapped
  to one generic reason, same anti-enumeration posture as `admin_boundary`.
- `meeting/call.js` gets the equivalent server-side gate, reusing
  `authorizeAction(..., Actions.SEND_MESSAGE)` rather than inventing a
  separate `PLACE_CALL` rule for an identical "can these two people
  communicate" policy. **Implementation note:** the check reads the
  other-participant id from the room's raw (unpopulated) `people` array,
  not the already-`.populate()`d one already in scope — verified
  empirically that Mongoose's populate silently *drops* an array entry
  whose reference no longer resolves (does not leave a dangling
  unpopulated ObjectId), so looking for "other" in the populated array
  would never find a hard-deleted recipient and silently skip the gate.
- Frontend: `TopBar.jsx`'s client-side `onlineUsers` pre-flight check is
  kept as-is (legitimately UX — skips a round-trip when presence already
  shows they're not connected) but is no longer the only gate; the `call()`
  catch block now reads the server's `reason` and shows a precise message
  ("This person's account is no longer available" / "You can't call this
  person") instead of a generic error. Delete-confirmation dialog copy
  updated to describe the real (now correct) behavior instead of implying
  nothing changes structurally.

**Trade-offs:** `deletedBefore` only ever grows forward — there is no
explicit "restore full history" action a user can take (not requested;
matches every mainstream messenger's actual behavior, where deleting a
chat and having it reappear never resurrects the deleted portion either).
`accountStatus` transitions to `DEACTIVATED` are unreachable today (no
route sets it) — intentional, reserved for a future feature, not
speculative code left unexercised in a load-bearing path.

**Testing:** `backend/test/conversation-delete-lifecycle.test.js` (delete
sets both timestamps; new message clears only `deletedAt`; restored
conversation shows only post-cutoff messages for the deleter, full history
for the other participant; `list-rooms.js` exclude/re-include cycle;
repeated delete advances the cursor), `backend/test/message-recipient-unavailable.test.js`,
`backend/test/meeting-call-authorization.test.js` (hard-deleted/deactivated/
blocked/admin-boundary/normal-call regression), plus new
`frontend/src/features/Conversation/components/TopBar.test.jsx` cases for
the reason-mapped call-error toasts. Full suite: 246/246 backend, 62/62
frontend, zero regressions.

---

## D-034: Admin privacy boundary — normal users get zero discovery/interaction with privileged accounts — 2026-08-17

**Problem:** Chitcx had no privacy boundary between normal users and
privileged (admin/root) accounts. `User.level` (`'standard'` default,
`'root'` seeded for the operator account, `'admin'` anticipated by the
frontend Admin badge but never actually assigned by the backend) was
checked in exactly two places — `user-delete.js` and `user-edit.js`, both
mutation-only admin-self-service routes. Every discovery/interaction
surface (search, profile lookup, friend requests, room/group creation,
messaging, calls, presence, Socket.IO) was completely level-blind: a
standard user could find, message, friend-request, group-add, or call an
admin exactly like any other user, and the presence layer broadcast every
connected user's online status — admins included — to every socket with no
filtering.

**Threat model:**
- **IDOR / direct API access.** A user who somehow learns an admin's
  `_id`/username (leaked elsewhere, guessed, or previously discovered
  before this fix) must not be able to reach them through `room/create`,
  `friend-requests`, `users/:username`, `messages/*`, `meeting/*`, or a
  raw Socket.IO event — verified with tests that hit these routes with a
  real admin id *without* discovering it via search first.
- **Account enumeration.** Every denial for "target is privileged" returns
  the exact same response shape/status as the route's own existing
  "doesn't exist" / "discovery off" case — never a distinguishable 403 or a
  `reason` field that leaks *why* — so a client can never tell "no such
  user" apart from "that user exists and is an admin." A real bug was
  caught by the test suite during implementation: an early version of
  `create-room.js`/`message.js` correctly returned 404 but still included
  `reason: 'admin_boundary'` in the JSON body — a working side channel that
  would have let an attacker binary-search which ids are admins. Fixed by
  stripping the reason for this specific denial path everywhere it occurs.
- **Group membership leakage.** Deliberately scoped: the boundary applies
  to 1:1 DMs only, not groups (confirmed product decision). Group
  membership is a shared space, not a discovery surface — a standard user
  legitimately sharing a group with an admin does not lose the group. What
  *is* still enforced: that admin never becomes discoverable through
  search/profile-lookup/friend-request/a *new* 1:1 DM just because they're
  visible as a group participant. Tested explicitly as two paired
  assertions (group access survives; general discoverability doesn't leak
  from it).
- **Notification/presence leakage.** `store.onlineUsers`'s four write sites
  (`init.js` connect/disconnect, `mediasoup/index.js` busy/online
  transitions, `events/status.js`) previously ended in one global
  `store.io.emit('onlineUsers', [...])` — literally every connected socket
  received every other user's live presence, admins included. Replaced
  with `backend/src/presence.js`'s `broadcastPresence()`, which computes a
  caller-scoped view per currently-connected socket (privileged callers see
  everyone including each other, standard callers never see a privileged
  entry) and never sends the `level` field itself to any client. Message
  delivery notifications (`message.js`'s `message-in` emit loop) already
  follow room membership, which the new `roomHasBoundaryViolation` gate
  covers.
- **Reconnect/resync bypass.** `sync-messages.js` (the reconnect gap-fill
  path) independently re-checks the boundary rather than assuming
  `join-room.js` already enforced it once — a vault token or a boundary
  check performed at initial join must not be trusted to still hold
  minutes later on a long-lived connection; every read route re-derives it
  per request, matching the existing `requireVisibleConversation` pattern
  this feature extends.

**Decision — `level !== 'standard'` (not an allowlist), caller-scoped
queries (not a separate admin route):**
- **Privileged = `level !== 'standard'`.** Covers `'root'` today and any
  future `'admin'`/other role automatically — deny-by-default, no code
  change needed when a new role is introduced. Implemented as
  `isPrivileged()` in `backend/src/authorization/policy.js`, the same
  choke-point `authorizeAction()` already used by `message.js`,
  `create-room.js`, `friend-requests/send.js` for block/relationship
  checks — extended with optional `actorLevel`/`targetLevel` params so
  existing call sites that don't pass them are completely unaffected until
  explicitly wired in, and the boundary check runs *before* the
  relationship/block lookup since it must win unconditionally.
- **No new admin-only listing endpoint.** `search.js` (and `user-list.js`)
  build their query conditionally on the *caller's own* level — a
  privileged caller gets the unfiltered query (admins see everyone,
  including each other; this is what keeps the existing Admin console
  working with zero frontend changes, since it already free-rides on
  `/api/search`), a standard caller's query excludes `level !== 'standard'`
  rows at the database level, not via a post-hoc filter.
- **1:1 room boundary via a new shared helper**,
  `backend/src/utils/roomHasBoundaryViolation.js` (same shape/spirit as the
  existing `requireVisibleConversation.js` vault-hide gate) — returns
  `false` immediately for `room.isGroup`, otherwise checks whether the
  other 1:1 party is privileged while the caller isn't.
  `join-room.js`/`get-room.js`/`more-messages.js`/`sync-messages.js`/
  `message.js`/`meeting/call.js`/`list-favorites.js` all call it
  independently — no route assumes a sibling route already enforced it.
  `list-rooms.js` and the Socket.IO `more-rooms` event apply the same rule
  as a batched `$nin` exclusion at query time.

**Pre-existing bugs found and fixed while implementing this** (each was a
real gap independent of the admin boundary, but left unfixed would have
undermined it):
- `checkUser.js` had **no auth middleware at all** and returned the full
  raw `User` document — password hash, email, `vaultPinHash` included — to
  anyone who sent a user's `_id`. This route is called at app boot
  (`frontend/src/init.js`) before a valid `Authorization` header exists, so
  it can't simply be wrapped in `passport.authenticate`; fixed by having it
  verify the actual JWT server-side (signature, expiry, session revocation
  — mirroring what the passport-jwt strategy does) instead of trusting a
  client-supplied raw `id`, and returning only `{valid: true}`, never the
  document. Frontend updated to send the token itself instead of the
  locally-decoded (unverified) `id`.
- `create-room.js` and `create-group.js` both populated the newly-created
  room's `people` with **no field exclusion at all** on first response
  (every other populate call site in these files excluded
  email/password/friends) — a brand-new room or group's first API response
  included the full raw `User` document, password hash included, for every
  member. Fixed alongside the `level`-stripping already needed for the
  boundary itself.
- `create-group.js` had zero validation of any kind — no check that
  `people` resolves to real users. Fixed to validate existence (not
  privilege — groups are exempt from the boundary by design).
- `meeting/add.js`, `meeting/answer.js` trusted a raw client-supplied
  `userID` with no existence check, letting any user "call-add" or "answer
  for" an arbitrary id. Both now resolve and validate the target, silently
  no-op-ing (still 200, no distinguishable failure) on a boundary
  violation, matching the fire-and-forget shape the rest of the
  call-signaling routes already use.
- `user-list.js` built a regex directly from unescaped user input
  (`` `.*${search}.*` ``) — a ReDoS/regex-injection risk — and had a dead
  self-exclusion filter (`email: {$ne: 'TODO my email'}`, a hardcoded
  literal that never matched anything). Fixed alongside adding the same
  boundary/escaping treatment `search.js` already had.
- `more-messages.js` (HTTP) had no room-membership check at all before
  this — any authenticated user could page through any room's message
  history by id. Fixed in passing since the boundary check needed the room
  fetched anyway.

**Not changed:** `relationships/block.js`/`unblock.js` (blocking an admin
is not a discovery/interaction the boundary needs to prevent — arguably the
opposite), `meeting/close.js` (a "call ended" signal reveals nothing new
and blocking it would just leave a stuck UI with no privacy benefit),
`conversation-hide.js`/`conversation-unhide.js`/`conversation-delete.js`/
`vault-*.js`/`message-read.js`/`message-delete.js` (all keyed by the
caller's own state on a room they're already a member of — no target-user
lookup exists in any of them to gate).

**Follow-ups intentionally not fixed in this pass** (flagged, not silently
dropped): `create-group.js` still has no blocked-user or discovery-opt-out
check for invitees (broader hardening than the admin boundary itself
required); the Socket.IO `more-messages`/`more-images` events (as opposed
to their HTTP twins, which are now gated) still have no room-membership
check at all; `meeting/*` routes don't verify the actor is an actual
participant of the target meeting beyond room membership.

**Testing:** `backend/test/admin-boundary.test.js`, 48 new tests — one
`describe` per critical path named in the task (search, profile lookup,
friend request, DM creation, existing-DM post-hoc denial across all four
read routes plus reconnect/resync specifically, group exemption with its
two-paired-assertion nuance, calls, favorites, presence via a real
multi-socket harness, direct-ID enumeration, the `checkUser.js` fix), each
paired with a normal-user-to-normal-user regression assertion in the same
block rather than a separate pass. Backend 192/192 total, zero regressions
in the pre-existing 144.

---

## D-033: In-call UI brought up to the shadcn/Tailwind design system — 2026-08-17

**Problem:** `Meeting/index.jsx`'s in-call screen (control bar, top bars) and
`LittleInterface.jsx` (small remote-peer tiles) had never been migrated off
the pre-D-020 template UI — flat rectangular buttons with raw `bg-secondary`
fills, no hover/active states beyond a background swap, `7vw`-based sizing,
and `LittleInterface.jsx` still used the legacy `Picture` component (bare
`.img`/`.picture` classnames, no Tailwind) instead of the shadcn `Avatar`
already used everywhere else, including its own sibling `Interface.jsx`.
This was the one screen in the app CLAUDE.md's "sitewide, not just chat"
design-language rule hadn't reached yet.

**Decision:** Rebuilt the control bar as a single floating rounded pill
(glassmorphism: `bg-black/50` + `backdrop-blur-xl`, matching the vocabulary
already established in `Join.jsx`/`Ringing.jsx`) using a small local
`ControlButton` helper so seven near-identical className strings couldn't
drift out of sync, with a real active/inactive visual state (primary-tinted
when a feature is on, neutral white/10 when off) instead of a flat uniform
fill — and fixed the icon semantics along the way: buttons now show the
icon for the action a click performs (e.g. a Minimize icon while maximized,
offering to shrink), not the current state, which the original had
backwards. `Interface.jsx` and `LittleInterface.jsx` both moved to
`Avatar`/`AvatarFallback` with the same gradient-fallback treatment used
throughout Conversation/Panel, and `Streams.jsx` gained gap spacing between
grid tiles (previously touching edge-to-edge, now that `Interface.jsx` has
rounded corners) plus the same ambient radial-glow background already used
on the Join/Ringing pre-call screens.

**Bug fixed in passing:** `TopBarTransparent`'s local-preview `useEffect`
depended on `[localVideoRef]` — a ref object, which never changes identity
across renders — so the effect only ever ran once on mount, meaning the
grid-mode local camera preview could silently never receive its stream if
the `<video>` element wasn't present at first mount. Changed to depend on
`[localStream]`, matching the sibling `TopBar` function's already-correct
pattern.

**Testing:** No new unit-testable surface (pure presentational change) —
verified via the existing 55/55 frontend test suite (unaffected) and a
clean production build. Visual correctness not yet confirmed against a live
call in this pass.

---

## D-032: Calls survive route navigation — mediasoup session hoisted out of the Meeting route component — 2026-08-17

**Amendment (2026-08-17, same day):** The hoist introduced a real
regression — a complete black screen on every call. Root cause: in
`callManager.js`'s `join()`, the initial `RTC_PRODUCERS` dispatch (the
batch of producers already active in the room at join time — i.e. the
other participant's already-on camera/mic) ran *before* the
`store.subscribe()` listener that consumes new producers was registered.
`store.subscribe()` only fires on *subsequent* state changes after
registration — unlike the original component's `useEffect([producers])`,
which always runs at least once on mount regardless of code order. The
practical effect: the initial producer batch was recorded in Redux but
never consumed into an actual `MediaStream`, so nothing ever rendered.
Fixed by registering both the producers-subscription and the
closing-state-subscription *before* the `RTC_PRODUCERS` dispatch, so the
dispatch itself is what the listener reacts to — restoring the same
"always see the initial batch" guarantee the old mount-effect had.
Confirmed via user report that calls worked before this refactor and
broke immediately after, isolating it to this ordering bug rather than a
pre-existing mediasoup/server config issue. Frontend 55/55 unaffected
(no unit-testable WebRTC surface); fix verified by static trace of the
dispatch/subscribe ordering, not yet by a live call — flagging that this
still needs a manual verification pass.

**Problem:** The entire mediasoup call session (Device, send/recv
transports, audio/video/screen producers) lived as `<Meeting/>`
component-local `useState` and module-level `let`s. `/meeting/:id` is a
plain sibling React Router route, so navigating to any other route (a
different DM, Settings, the vault) fully unmounted `<Meeting/>`. Two broken
outcomes followed: (1) the only unmount cleanup was gated behind
`callStatus !== 'in-call'`, which is always false mid-call, so the cleanup
never ran — camera, mic, and **screen-share** kept broadcasting
indefinitely with zero in-app indication, and no `leave` socket event ever
reached the server, which has no concept of frontend routes and just kept
relaying forever; (2) clicking "Go back to the meeting" remounted
`<Meeting/>` fresh — `joined`/`callStatus` (reactn globals) survived and
skipped the Join/Ringing screens, but `device` (component `useState`) reset
to `null` while `transport`/producers (module `let`s) still referenced the
live pre-navigation session. Any code needing `device` — consuming a new
remote producer that appeared while away — threw
`Cannot destructure property 'rtpCapabilities' of null`, silently.

**Decision:** Hoist the entire session into `frontend/src/lib/callManager.js`,
a plain module-level singleton — not React state, since mediasoup objects
aren't render-driven and don't need to be. `join`, `produceAudio/Video/
Screen`, `stopAudio/Video/Screen`, `consume`, and the one true teardown path
`leave()` all live there now. `<Meeting/>` (`frontend/src/features/Meeting/
index.jsx`) is a thin UI shell: it calls into `callManager` and renders
whatever `reactn`/Redux state is current, exactly like the new
`PictureInPicture` tile does when `<Meeting/>` isn't mounted at all. Two
Redux-store subscriptions that used to be component effects — "consume a
new remote producer" and "the counterpart hung up" (`RTC_CLOSE` →
`closingState`) — moved into `callManager` itself, since both need to keep
working while `<Meeting/>` isn't mounted; previously the latter only fired
inside `<Meeting/>`'s own effect, meaning a remote hang-up while the local
user had navigated away was never noticed and the local session kept
running with no one on the other end.

**Also added: a persistent floating PiP video tile**
(`frontend/src/features/PictureInPicture/index.jsx`), mounted once at the
app root as a sibling to `<Routes>` in `App.jsx` so it's never unmounted by
navigation. Visible whenever a call is active and the user isn't on
`/meeting/:id`, showing the live local camera/screen-share feed (not just a
static "in call" bar) plus a direct hang-up button. This is the fix for the
privacy half of the bug: the user can now *see* they're still broadcasting
while browsing other chats, rather than the previous behavior of either
silently continuing invisibly or being unable to leave the meeting page at
all without ending the call.

**Trade-off:** Navigating away from a call no longer implicitly ends it —
that's now only possible via the explicit hang-up button (in `<Meeting/>`
or the PiP tile). This is the intended behavior per the existing
`MeetingBar` "return to call" affordance, which previously didn't actually
work correctly (bug #2 above) — it does now, since remounting `<Meeting/>`
is purely a UI reattachment to the same live `callManager` session, not a
new one.

**Testing:** No unit-testable WebRTC/mediasoup surface (no real media stack
in the test environment) — verified via full existing test-suite regression
(55/55 frontend tests unaffected, confirming no import cycles or render
breakage from the refactor) plus a clean production build. Manual
verification: start a call, toggle screen-share, navigate to a different
DM — confirm the PiP tile shows the live feed and the remote participant's
stream is uninterrupted; have the remote participant join a third peer or
toggle their camera while the local user is away — confirm the new stream
renders correctly on return with no console error (the direct regression
check for the null-`device` crash); confirm hang-up from either the Meeting
page or the PiP tile cleanly stops capture and notifies the other
participant.

---

## D-031: Private Vault — per-user conversation hide/delete, WebAuthn+PIN step-up auth — 2026-08-17

**Amendment (2026-08-17, same day):** The initial implementation had
`requireVisibleConversation` 404 on `deletedAt` for every read route
(join-room/get-room/more-messages/sync-messages) — the intent was an
IDOR-style "can't route around delete via a stale link" guarantee, but
`deletedAt` only ever reflects the *requesting* user's own delete action on
their own state row; there is no other-user scenario it protects against,
since nobody can be blocked by anyone's delete but their own. In practice
this meant a user who deleted a conversation and then reopened it (still
had the tab open, deep-linked back in) got a hard "Room Not Found" and
**could not send a message back into their own conversation** — confirmed
via live report with screenshots. Fixed by removing the `deletedAt` check
from `requireVisibleConversation` entirely (`isHidden`/vault-token gating
is unaffected); deleting a conversation now only removes it from the inbox
*listing*, never blocks the deleter's own direct access or ability to
reply, matching WhatsApp's actual behavior (delete a chat, reopen it,
message — it just works and un-deletes). Also fixed `message.js`'s
reappear-on-new-message logic, which previously only cleared `deletedAt`
for *recipients* — the sender messaging back into a conversation they'd
deleted never cleared their own `deletedAt`, so it stayed hidden from their
own inbox indefinitely even while actively being used. Now both sender and
recipients get `deletedAt` cleared on any new message in the room. 30
backend tests updated/added (`test/conversation-privacy.test.js`) — the
one test asserting the old 404-after-delete behavior was replaced with one
asserting 200, plus a new test covering the sender's-own-message
un-delete case. Backend 144/144, frontend 55/55.

**Problem:** No per-user conversation privacy existed at all. `Room.js` had
zero hide/mute/archive fields, and the only existing "remove conversation"
route (`remove-room.js`) is a destructive hard delete affecting every
participant with no socket notification — unusable as a basis for "hide this
DM from just me."

**Data model:** New `ConversationUserState` collection —
`{conversation, user, isHidden, hiddenAt, deletedAt}` with a unique
`(conversation, user)` index — rather than array fields bolted onto `Room`,
since two independent per-user booleans are naturally one row per pair, and
rows are created lazily only on first hide/delete (no row = normal visible
state, the common case). Mirrors the tombstone-not-hard-delete philosophy of
D-030: `Room`/`Message` documents are never touched by hide or delete.

**Delete vs. Hide, kept conceptually separate as specified:** "Delete DM"
sets `deletedAt` on the requester's own state row only — the other
participant's copy and the shared message history are completely
untouched, and it's idempotent (`findOneAndUpdate` upsert). "Hide/Lock DM"
sets `isHidden` and moves the conversation behind a second, separate
authorization gate — the Private Vault — rather than just filtering it
client-side.

**Vault authorization — a short-lived, purpose-scoped step-up token, not a
second auth system:** unlocking (via PIN or WebAuthn passkey) issues a JWT
signed with the same secret/library as the main login token, scoped by a
`purpose: 'vault'` claim and a 10-minute expiry, sent as a separate
`X-Vault-Token` header (the frontend's `axios.defaults.headers.common.
Authorization` slot is already permanently owned by the main login JWT, so a
second credential needed its own channel). The vault token can never grant
anything the main JWT doesn't already imply — `requireVaultAuth` re-checks
`decoded.id === req.user.id` on every use, so a stolen vault token can't be
replayed against a different account, and every underlying route still
independently re-verifies room membership and ownership.

**Every read path re-checks visibility independently — no route trusts a
sibling route's earlier check:** `join-room`, `get-room`, `more-messages`,
and `sync-messages` each call the same `requireVisibleConversation` helper
and each require a *currently valid* vault token whenever the conversation is
hidden. This was a deliberate fix during planning — an earlier draft assumed
only `join-room` needed the check since "the client already unlocked once to
get here," but a vault token expires in 10 minutes while a room stays open
far longer, so a stale room id could otherwise pull hidden content through
`more-messages`/`sync-messages` after the token expired. `list-rooms.js`
excludes hidden/deleted conversations from the normal inbox entirely
(batch-loaded exclusion list, same shape as `search.js`'s relationship
annotation) — hidden content cannot be discovered through the normal
inbox/search/unread-preview surface, satisfying the "excluded server-side,
not CSS-hidden" requirement.

**WebAuthn passkey registration is a privileged action once a vault already
exists:** registering a *new* passkey with only the main JWT (no vault
token) is allowed solely on first-ever setup, when there's nothing yet to
protect. Once a PIN or any credential exists, registering another passkey
requires a valid vault token — otherwise a stolen main JWT alone could
silently enroll an attacker's own authenticator and gain standing vault
access. Registration/authentication challenges are stored in a single-use,
delete-on-read in-process Map (`webauthnChallenges.js`) rather than a signed
JWT challenge — a JWT challenge is time-limited but replayable any number of
times within its TTL, which fails the "truly single-use" bar; the in-process
Map has the same multi-instance ceiling as the existing `store.onlineUsers`
presence tracking, not a new one.

**Reappear-on-new-message (WhatsApp-like):** a "deleted" conversation
un-deletes back into the recipient's inbox the moment the other participant
sends a new message — it's "delete my current view," not a block (blocking
already exists separately via `relationships/block.js`). A *hidden*
conversation does not auto-unhide on a new message — it stays in the vault,
and the sender is never told the conversation was hidden, per spec.

**Rate limiting:** vault-unlock attempts (PIN verify, passkey assertion
verify) get their own tier — 8/15min, materially tighter than the 20/15min
`authLimiter` — since a 4-12 digit PIN has far less brute-force resistance
than a password. Hide/unhide/delete mutations reuse the existing
`deleteLimiter` tier (60/15min), same reasoning already documented there for
message deletion: a mutation on existing data, not spam-creation.

**Testing:** 29 new backend tests (`test/conversation-privacy.test.js`) —
delete-for-me-only-not-other-participant, idempotent hide/unhide/delete, IDOR
rejection on manipulated conversation ids, all four read routes independently
rejecting a hidden room without a vault token (including the specific
regression case of a token expiring after `join-room` already succeeded),
vault-token cross-user rejection, PIN wrong-vs-unconfigured returning the
same generic reason (no enumeration side-channel), WebAuthn registration
authorization tiers, WebAuthn challenge single-use, and multi-device
Socket.IO sync (hiding on device A reaches device B, never the other
participant). 13 new frontend tests covering the six-item dropdown menu
(Search/Mute/Report disabled, Hide/Delete/Block functional), the
confirm-before-mutate dialogs, first-time PIN setup, PIN and passkey unlock,
and the unlocked vault list. Backend 134/134, frontend 52/52, both builds
clean.

---

## D-030: WhatsApp-style message deletion — tombstone, not hard delete — 2026-08-17

**Problem:** No way to delete or retract a sent message. Needed both a
private "remove from my view" and a real "delete for everyone" that revokes
content for the whole room, without breaking ordering, pagination, replies,
or reconnect-resync.

**Decision — tombstone over hard delete:** `Message` gained
`deletedForEveryone` (Boolean), `deletedAt` (Date), and `deletedFor`
(`[ObjectId]`, mirroring the existing `readBy` array pattern). The document
is never removed — its position in the room's message history stays fixed,
which is what pagination/reply-anchoring/sync already depend on. A schema-level
`toJSON` transform nulls `content`/`file` once `deletedForEveryone` is true,
so any route serializing a real Mongoose document gets automatic stripping
for free. Routes using `.lean()` (`more-messages`, `sync-messages`,
`join-room`) bypass that transform, so they run a shared
`sanitizeDeletedMessage()` helper explicitly, and all three also filter out
messages present in the requesting user's `deletedFor` array — verified this
was necessary for `create-room.js` specifically by writing a throwaway script
confirming `toJSON` *does* fire on documents nested inside a plain object via
`JSON.stringify`, so that one route needed only the `deletedFor` filter, not
manual stripping.

**Authorization:** `POST /api/message/delete` accepts `{roomID, messageID,
forEveryone}`. Delete-for-me: any room member, any message — same rule
WhatsApp uses, since it only affects the requester's own view. Delete-for-
everyone: author-only (403 `not_author` otherwise) and inside a configurable
window (`config.messageDeletionWindowMs`, default 1 hour via
`MESSAGE_DELETION_WINDOW_MS`), enforced server-side only — the client always
shows the option and surfaces the server's 403 `deletion_window_expired`
rather than duplicating the window as a second source of truth.

**Idempotency:** delete-for-me uses `$addToSet` (naturally idempotent);
delete-for-everyone checks `if (!message.deletedForEveryone)` before
mutating, so a retry/double-click returns the existing tombstoned state
instead of erroring or re-stamping `deletedAt`.

**Realtime sync:** reuses the existing personal-room-emit pattern from
`message.js`/`message-read.js`. Delete-for-everyone broadcasts
`message-deleted` to every other room member (not the actor, who already has
optimistic local state). Delete-for-me broadcasts only to the actor's own
personal room, so their other devices/tabs hide the message too — it never
reaches other participants, since it's not their state to change.

**Frontend:** one new `MESSAGE_DELETE` reducer case — `forEveryone: true`
patches the message in place (position preserved, content nulled) so the
bubble renders a muted "This message was deleted" placeholder;
`forEveryone: false` filters the row out of `state.messages` entirely. A
hover-revealed dropdown (shadcn `DropdownMenu`) offers "Delete for me"
always, "Delete for everyone" only when `isMine`, gated behind a
confirmation `Dialog` for the destructive/shared action only — matching
WhatsApp's own asymmetry of confirming the action visible to others but not
the purely-local one.

**A real jsdom gap found while testing this:** Radix's `DropdownMenu` opens
on `pointerdown` and jsdom has no Pointer Events capture API
(`hasPointerCapture`/`setPointerCapture`), so `fireEvent.click` alone never
opened the menu in tests. Fixed two ways: added no-op polyfills to
`setupTests.js` (same pattern already used there for `ResizeObserver`), and
switched the interaction tests to `@testing-library/user-event`, which
dispatches the full pointer/mouse event sequence Radix actually listens for.

**Testing:** 18 new backend tests (`test/message-deletion.test.js`) —
delete-for-me (hides for requester, any member can do it, idempotent,
rejects non-member), delete-for-everyone (author-only within window, IDOR
rejection, expired-window rejection, idempotent without re-stamping
`deletedAt`, non-member rejection, validation, auth), and content-stripping
verified across every message-listing route (join-room, more-messages,
sync-messages) plus a regression check that plain message sending still
works. Backend 105/105. 9 new frontend tests covering the placeholder, menu
visibility by ownership, delete-for-me firing immediately, delete-for-
everyone requiring confirmation first, and the expired-window error path.
Frontend 39/39. Lint clean, production build clean.

---

## D-029: Instagram-style friend-request lifecycle — 2026-08-17

**What was already correct (D-026/D-028), confirmed before changing
anything:** the server already rejected a duplicate request while one was
pending (unique index on `{requester, recipient}`, 409 response) — frontend
disabling alone was never the only enforcement. The real gaps were narrower
than "implement server-side enforcement": decline had no way back to a fresh
request, search result cards showed no relationship status at all, and the
"Requested" state only appeared after the network round-trip instead of on
click.

**Decline → re-request:** `friend-requests/send.js` previously treated *any*
existing relationship row — including a `declined` one — as a 409 conflict,
so a decline was a permanent dead end. Fixed by reusing the existing row
(same pattern already established for blocking in `relationships/block.js`):
a `declined` row gets reset to `pending` with `requester`/`recipient`
reassigned to reflect who's sending the new request, rather than inserting a
second row (which the unique index wouldn't allow anyway). Any other status
(`pending`/`accepted`/`blocked`) still 409s as before.

**"Friends" badge in search results:** `POST /api/search` and `GET
/api/friends` now annotate every returned user with `relationshipStatus`
(`'accepted'` / `'pending'` / `null`) and, for pending, `relationshipDirection`
— computed via one batched `Relationship` query across the whole result set,
not one lookup per row. A `blocked` relationship is deliberately reported as
`relationshipStatus: null` in list results (not surfaced as a badge at all)
for the same reason `resolve.js` already hides block direction: search
results are not the place to reveal that a relationship exists at all when
it's blocked. Both `AddPeople.jsx`'s dialog search and `Panel/User.jsx`'s
`/search` page result cards render the same "Friends" badge from this shared
field, and both skip the profile-preview step for an already-accepted friend
— clicking the card opens the DM directly via the same `create-room.js` path
every DM already uses (find-or-create, no duplicate rooms).

**Optimistic "Requested" state:** `AddPeople.jsx`'s `sendRequest()` now sets
`relationship` to `{status: 'pending', direction: 'outgoing'}` synchronously,
before the `sendFriendRequest()` call even starts — the button disables and
relabels to "Requested" on the same render as the click, which is what
actually prevents a rapid second click (React re-renders with `disabled`
before any network round-trip completes). On a genuine failure (not a 409)
the optimistic state reverts to "Add Friend"; on a 409 it stays "Requested"
since that remains an accurate reflection of server state. This is UX
responsiveness layered on top of the real enforcement, not a replacement for
it — the server-side unique-index/policy check is unchanged and is what
actually stops a spammed request, exactly as it already did before this pass.

**A real bug found while testing this, not present before:** the first
attempt at the `search.js` annotation called `.toObject()` on each result,
assuming they were Mongoose documents — but `search.js` uses
`User.aggregate()`, which returns plain JS objects, not documents.
`.toObject()` doesn't exist on those and threw inside every search request.
Caught immediately by the existing search test suite failing (not new tests
— the pre-existing `search.js` regression tests), fixed by spreading the
plain object directly instead.

**Testing:** 10 new backend tests (`test/friend-request-lifecycle.test.js`)
— duplicate-pending rejection (both directions of an accepted relationship
too), decline-then-resend in both directions, pending-cannot-be-resent
(decline-only reuse), and search/friends annotation correctness including
the blocked-stays-hidden case. 5 new frontend tests covering the optimistic
disable-on-click (including a same-tick second-click-is-inert assertion),
revert-on-real-failure, the Friends badge appearing/not-appearing correctly,
and both click-through paths (friend → direct DM, non-friend → profile
preview). Backend 87/87, frontend 32/32, both builds clean.

---

## D-028: Friend/stranger chat authorization — blocking + centralized policy + call/voice fixes — 2026-08-17

**Starting point, confirmed before writing anything:** Chitcx was already
messaging-first — `create-room.js` never checked friendship (it just finds-or-
creates a 1:1 room), and `message.js` already authorized by conversation
membership, not relationship status. The actual gaps against the requested
architecture were narrower than "implement messaging-first": no `blocked`
relationship state existed anywhere, authorization checks were scattered
per-route rather than centralized, and there was no stranger-specific rate
limiting.

**Relationship model:** added `'blocked'` to `Relationship.status`'s enum and
a new `blockedBy` field. The existing `{requester, recipient}` unique index
(one row per direction) meant blocking couldn't insert a second row without
colliding — a block instead **overwrites** whatever row already exists
between the two users (reusing it regardless of its prior status), while
`blockedBy` (independent of `requester`/`recipient`) records who actually
did the blocking. Unblocking deletes the row outright rather than trying to
restore whatever state a block overwrote, since that prior state is genuinely
gone — both users return to NONE and can re-request from scratch.

**Centralized authorization policy** (`backend/src/authorization/policy.js`,
new module, same shape as the existing `src/ai/` module convention):
`authorizeAction({actor, target, action})` → `{decision: ALLOW|DENY, reason?}`.
Checks self-targeting and block status first, unconditionally, before any
action-specific logic — block always wins. Wired into `create-room.js`
(START_CONVERSATION), `message.js` (SEND_MESSAGE, 1:1 rooms only — see
below), and `friend-requests/send.js` (SEND_FRIEND_REQUEST), replacing their
previous ad-hoc self-target/relationship-lookup logic. **Deliberately not**
wired into `friend-requests/accept.js` — that route's existing
`{_id, recipient: req.user.id, status: 'pending'}` query is already more
precise than the policy's generic actor/target lookup (it's scoped to one
specific request by ID, which the generic version has no way to express) —
routing it through the shared policy would have been a regression, not a
simplification. Not every check needs to go through the shared module; the
principle is "don't duplicate scattered ad-hoc logic," not "eliminate all
route-specific authorization."

**Group vs. 1:1 scoping, a deliberate boundary:** block enforcement only
applies to 1:1 DMs. A block is a relationship between two people, not a
group-membership/moderation concern — per the spec's own "Friendship ≠ DM
membership ≠ Group membership ≠ Group role" principle, a 1:1 block does not
reach into a group conversation both users already share. Tested explicitly
(D-028 test suite): a group message from a user who's been 1:1-blocked by
another member still succeeds.

**New routes:** `POST /api/block`, `POST /api/unblock` (both mounted under
the existing `discoveryLimiter`, alongside `/api/room/create` which was also
added to that limiter for the first time — per the spec's explicit "rate
limit new conversations" ask). `users/resolve.js`'s relationship payload now
omits `direction` and normalizes to `{status: 'blocked', direction: null}`
for a blocked relationship, regardless of which side blocked — leaking block
direction would let a blocked user infer they were specifically targeted
rather than just observing "user unavailable."

**Frontend:** `AddPeople.jsx`'s `ProfilePreview` now renders all five states
from the spec's UX table (NONE/PENDING_SENT/PENDING_RECEIVED/ACCEPTED/BLOCKED)
— Start Chat stays primary throughout except when blocked, where it's
replaced entirely by a "User unavailable" state per "frontend visibility is
UX only, server authorization remains mandatory." New "Accept Request" and
"Block" actions added to the preview.

**Explicitly not built this pass, matching "don't over-engineer the MVP":**
per-contact stranger message-count throttling (the spec calls this optional/
configurable) — only the existing IP/session-based rate limiters apply to
stranger messaging, no new per-relationship throttling logic. Report-user
action (mentioned in the spec's action list but no moderation/report
infrastructure exists to receive it yet — would be a stub with nothing behind
it). Neither React Query nor a second server-state system — reused the
existing axios-action + Redux/reactn pattern throughout, per the spec's own
explicit instruction not to introduce a competing pattern.

**Also fixed in the same pass (found via a "deep check" of the voice/video
calling system per a separate user report):**
- `backend/.env` was missing `MEDIASOUP_ENABLED` entirely (not `false` —
  simply absent), so the whole calling subsystem silently never initialized.
  Every `join`/`produce`/`consume` request from the client hung forever with
  no error, because `frontend/src/lib/socket.io-promise.js`'s Promise
  wrapper never rejected — only resolved on ack, no timeout. This is likely
  what "server issues with meeting calling" actually was.
- Fixed the promise wrapper itself: added a 15s timeout and reject-on-
  `{error}`-response, so a hung request now surfaces a real error instead of
  freezing the UI silently — this was a real bug independent of the missing
  env var, and would have caused the same silent-hang symptom for any future
  transient mediasoup failure.
- Added try/catch + proper `{error}` callbacks to five mediasoup socket
  handlers (`connectProducerTransport`, `connectConsumerTransport`, `produce`,
  `consume`, `resume`) that previously had no error handling at all — an
  unhandled throw in any of them (e.g. a missing transport after a stale
  reconnect) silently killed the handler with the client-side promise still
  hanging, per the same root cause above.

**Testing:** 16 new tests (`test/authorization-policy.test.js`) covering the
spec's explicit list — stranger DM/message/request with no relationship,
duplicate-DM prevention, block overriding accepted state, blocked user denied
on both new-DM and existing-DM messaging, blocked user denied on new friend
requests, unblock restoring access, only-the-blocker-can-unblock, group
messages unaffected by a 1:1 block, non-member denial independent of
relationship, self-targeting denial. Plus 1 existing test updated for
`resolve.js`'s new `relationship._id` field. Backend 77/77, frontend 27/27,
both builds clean.

---

## D-027: WhatsApp-style day separators + Socket.IO CORS fix + friends-only default search listing — 2026-08-17

**Day separators:** `Conversation/components/Messages.jsx` now inserts a
"Today"/"Yesterday"/full-date pill between messages whenever the calendar day
changes (`moment(...).isSame(..., 'day')`), matching WhatsApp's actual
behavior — a calendar-day boundary, not a rolling 24h window, so 11:59pm and
12:01am the next minute correctly land on separate days. Reused the existing
`moment` dependency already used throughout the conversation UI; no new
dependency. 4 new tests (`Messages.test.jsx`) cover same-day dedup, the
midnight-boundary split, and the "older than yesterday" full-date fallback.

**Real bug found and fixed while investigating an unrelated report ("chat is
not RTC" — real-time delivery not arriving live):** `backend/index.js`
constructed the Socket.IO server with `io(server)` — no `cors` option. Express's
`cors()` middleware only covers HTTP routes; Socket.IO's engine.io transport
does its own independent CORS check on the polling/WebSocket handshake. Since
frontend (`:5173`) and backend (`:4002`) are different origins, every socket
connection was silently rejected at the transport level — HTTP requests (login,
send, room list) all worked fine, masking the problem, but `message-in` could
never reach a recipient because the socket never actually connected. This bug
predates this session. Fixed by passing `Config.corsOrigin` (the same allowlist
already used for Express) to the Socket.IO constructor. Requires a backend
restart to take effect (boot-time config).

**Also chased and ruled out during the same investigation:** two apparent
"broken dropdown"/"broken message layout" reports both turned out to be a
stale browser tab holding a dead Vite HMR connection, not real bugs — confirmed
by comparing the DOM's actual Tailwind class list against current source
(they didn't match, even after a hard refresh) and only resolved by a full
tab close + reopen. Worth remembering: a hard refresh (Ctrl+Shift+R) bypasses
the HTTP cache but not a stuck WebSocket/HMR connection or a lingering service
worker — closing the tab is the real fix for that class of symptom.

**Friends-only default search listing:** `/search` previously called
`search()` with no query on mount, returning the *entire user directory*
(minus yourself) unfiltered — a real over-exposure, not by design. New
`GET /api/friends` route (`backend/src/routes/friends/list.js`) returns only
users with an **accepted** `Relationship` in either direction — reuses the
same `Relationship` model built for D-026's Add People feature (this is
exactly the extension point that model's generic requester/recipient/status
shape was designed for). `Panel/index.jsx`'s default listing and
`SearchBar.jsx`'s empty-query state both now call `getFriends()` instead of
the unrestricted `search()`. **Typing an actual @username still searches
everyone** — unrestricted lookup-by-username is the intended discovery
mechanism (Add People's whole purpose), only the *default, no-query-typed*
listing changed. Mounted behind the existing `discoveryLimiter` alongside
`/api/search`/`/api/users`/`/api/friend-requests`. 3 new backend tests cover
both-direction acceptance, exclusion of pending/declined/unrelated users, and
the auth gate.

**Testing:** backend 61/61, frontend 27/27, both builds clean.

---

## D-026: Add People (Phase 1) — username search, profile preview, friend requests — 2026-08-17
**Problem:** Discovering and messaging a new person was a single, ungated action —
clicking a search result immediately created a DM (`create-room.js`), with no
profile-preview step and no concept of a relationship between two users beyond
"a room exists." A much larger spec was requested (username search, QR codes,
invite links, friend requests, rate limiting, abuse detection, and forward-looking
Zero Trust/threat-intel/eBPF/AI security layers) — implemented as **Phase 1 only**
(username search + profile preview + Start Chat / Send Request), per the spec's
own phased rollout and two explicit scope decisions made with the user before
writing code (see below). QR codes and invite links are deliberately deferred.

**Decision — data-fetching pattern:** the spec called for React Query throughout.
This codebase has zero React Query usage anywhere — every existing feature
(including everything built earlier this session) uses plain axios action
functions + Redux/reactn globals. Introducing React Query for one feature would
mean two parallel state-management paradigms living side by side, which
CLAUDE.md's own rule against introducing patterns that conflict with the existing
system already argues against. **Built with the existing pattern instead** —
debouncing via the same `useRef` timeout pattern already used in
`Panel/components/SearchBar.jsx`, cancellation via a raw `AbortController` wired
through `axios`'s `signal` option (a small, backward-compatible addition to the
existing `actions/search.js`, not a new dependency).

**Decision — relationship model scope:** the spec wanted a full friend-request
gate before any messaging. **Kept "Start Chat" instant** (unchanged,
`create-room.js` untouched) and added "Send Request" as a new, separate,
optional action — matching the spec's own Phase 1 description ("search +
profile preview + start chat/request") rather than the larger, riskier
behavior change of gating all existing messaging behind approval.

**Implementation:**
- `User.usernameNormalized` (new field, lowercased mirror of `username`, unique+sparse
  index, kept in sync by a `pre('save')` hook) — makes username lookup/uniqueness
  case-insensitive, which Mongo doesn't support natively on a unique index. Every
  existing username-uniqueness check site (`register.js`, `user-edit.js`,
  `init.js`'s root-user bootstrap) was updated to use it — two of these bypass
  Mongoose's `save()` (`findOneAndUpdate`), so a one-time idempotent backfill runs
  on every boot in `init.js` for legacy users created before the field existed.
- `User.discoveryEnabled` (new field, default `true`) — the privacy gate the spec's
  "Discovery Service" section calls for. A user with discovery disabled and a
  genuinely nonexistent username both return **404**, not 403 — a distinguishable
  response would let an attacker enumerate which usernames are real even when
  hidden (the spec's own anti-enumeration requirement).
- `Relationship` model (new, deliberately not named "Friend") — generic
  requester/recipient/status shape (`pending`/`accepted`/`declined`), per the
  spec's explicit "don't hard-code around friends" instruction — adding a
  `blocked` status or a `room` field for group invites later is additive, not a
  schema rewrite. Compound unique index on `{requester, recipient}` (one row per
  direction) plus `{recipient, status}` for the incoming-requests list query.
- New routes, following the codebase's existing inline
  `passport.authenticate('jwt', ...)` mounting convention exactly:
  `GET /api/users/:username` (profile resolution), `GET/POST /api/friend-requests`
  (list / send), `POST /api/friend-requests/:id/{accept,decline}`. Accept/decline
  are IDOR-checked — scoped to `{_id, recipient: req.user.id, status: 'pending'}`
  — the requester or a third party cannot respond to a request addressed to
  someone else, regression-tested.
- New `discoveryLimiter` (100/15min, `express-rate-limit`, same pattern as the
  existing `authLimiter`/`aiLimiter`) mounted on `/api/search`, `/api/users`,
  `/api/friend-requests` — tighter than general API traffic given this is the
  spec's named enumeration/spam-abuse surface, looser than auth since search is
  used interactively while typing. Redis-backed rate limiting was considered
  (per the spec's "Redis where it makes sense" language) and explicitly not
  built — Redis has zero lines of usage anywhere in this backend today, it's
  documented-aspirational only; adding it for one feature's rate limiter would
  be new infrastructure introduced through the back door of a feature request,
  not a real capacity need. The existing in-memory limiter is correct for a
  single-process ₹0 deployment.

**Frontend:** `AddPeople.jsx` (search → results → profile-preview dialog →
Start Chat / Send Request), reachable from a new "Add Person" item in the
existing "+" menu in `Panel/components/TopBar.jsx` (previously single-purpose,
"Create Group" only). Incoming requests surface in the already-existing
Notifications page with accept/decline actions.

**What was explicitly not built (per the spec's own phasing, not an oversight):**
QR code generation/scanning (Phase 2), invite links with expiry/revocation
(Phase 3), dedicated abuse-detection beyond the rate limiter (Phase 4), and
every security-evolution item in the spec's later sections (Zero Trust risk
scoring, threat intelligence, eBPF, AI-based policy engine — Phases 5-8). The
model boundaries (`Relationship`'s generic shape, `discoveryEnabled`, a
dedicated rate limiter already separated from general API traffic) are exactly
what the spec asked to establish now so those phases don't require a rewrite
later — that groundwork is what Phase 1 was scoped to deliver.

**Testing:** 22 new backend tests (`test/add-people.test.js`) covering
case-insensitive uniqueness, profile resolution (including the 404-not-403
discovery-disabled case and the never-leak-email/password check), send/accept/
decline with IDOR and duplicate-request/reverse-relationship checks, and the
incoming/outgoing list split. 4 new frontend tests (`AddPeople.test.jsx`)
covering the minimum-query-length gate, debounce-coalescing behavior, and the
search → profile-preview → send-request flow end to end. Full suites green:
backend 58/58, frontend 23/23.

---

## D-024: Device-identity/session system — the E2EE prerequisite named in D-012 — 2026-08-16
**Problem:** `docs/E2EE-THREAT-MODEL.md` §3 and D-012 both concluded E2EE cannot
be built on the existing auth model — one long-lived (60-day) JWT per login,
no device/session concept anywhere, and (found during this pass) **no
server-side logout at all**: both existing "logout" implementations
(`Panel/components/TopBar.jsx` and the near-duplicate in `Settings.jsx`)
only deleted the client's local token copy. A captured or leaked token
remained valid for the rest of its 60-day life regardless of "logout."

**Decision:** Added a `Session` model (`backend/src/models/Session.js`) — one
document per login, holding `user`, `userAgent`, `createdAt`, `lastSeenAt`,
`revokedAt`. `login.js` now creates a `Session` on every login and embeds its
`_id` as a new `deviceId` claim in the JWT payload. Both trust surfaces check
it:
- **HTTP** (`init.js`'s passport-jwt strategy): if `payload.deviceId` is
  present, the session must exist and be unrevoked, or the request is
  rejected; `lastSeenAt` is touched on each authenticated request.
- **Socket.IO** (`init.js`'s `authenticate` handshake): same check, run before
  `onAuthenticated()` — a revoked session is disconnected with a
  `session_revoked` reason instead of ever joining.

**Backward compatibility, deliberately not a flag day:** tokens with no
`deviceId` claim (everyone already logged in before this shipped) are treated
as legacy sessions and trusted exactly as before — they simply have no
session to check. New logins get real sessions; old sessions age out
naturally over their existing 60-day expiry. No forced re-login for existing
users.

**New routes:** `POST /api/logout` (revokes the caller's own current
session, resolved from the same bearer token already on the request — no
new client-supplied session id, so nothing to spoof), `GET /api/sessions`
(list the caller's active sessions), `POST /api/sessions/revoke` (revoke a
specific session by id, IDOR-checked — scoped to `{ _id: id, user: req.user.id }`,
regression-tested). Revoking a session that has a live socket connection
disconnects it immediately (`store.sockets` scan in `sessions/revoke.js`)
rather than waiting for its next reconnect.

**Frontend:** both logout call sites now call the new `/api/logout` action
(fire-and-forget — local state is cleared either way, so a network failure
never blocks logout). New `Settings > Manage Sessions` dialog
(`SessionsPopup.jsx`) lists active sessions with device/user-agent and
last-active time, and lets the user revoke any session but the current one.

**Testing:** new `backend/test/session-revocation.test.js` (7 tests: legacy
tokens still work, revoked sessions are rejected on the next request, the
revoke route is IDOR-checked against `req.user.id`, logout actually revokes)
plus 2 new tests appended to `socket-auth.test.js` covering the same
revocation check on the Socket.IO handshake path specifically, since it's a
second, independent trust surface from HTTP. **Found and fixed a real test-
infra gap along the way:** `test/helpers/app.js` had its own hand-rolled
passport-jwt strategy that duplicated (and had silently drifted from) the
real one in `src/init.js` — it had no session check at all, so without
updating it, every route test in this suite would have exercised a fake
auth path and given false confidence. Updated it to match.

**What this does and doesn't unblock:** this is the device-identity
prerequisite the threat model named — there is now a natural place to attach
a per-device public key for E2EE key exchange later. It does **not**
implement E2EE itself; the threat model's remaining open items (group-room
key distribution, new-device history access, key rotation/revocation) are
unchanged and still unsolved by this pass. See the updated status note at
the top of `docs/E2EE-THREAT-MODEL.md`.

**Trade-off:** no refresh-token rotation or short-lived access tokens — the
JWT is still a single 60-day-lived token per session, just now individually
revocable. A full access/refresh-token split was considered and explicitly
scoped out (see prior `AskUserQuestion` decision) as more surface area than
this portfolio project's E2EE-unblocking goal requires.

---

## D-023: Structured logging (pino) + request IDs — closes the last P2 observability gap — 2026-08-16
**Problem:** The backend had zero structured logging — 42 `console.log`/`console.error`
call sites across 15 files, no request/correlation IDs, and no log levels (a
socket-disconnect message and a DB-connection failure were equally "just a
console.log"). This was the one item from the P2 plan (DB indexes, bounded
search, low-network optimizations, benchmarks, observability) still open;
everything else in P2 was already done and documented (D-014, D-017, D-018).

**Decision:** `pino` + `pino-http`, per the plan's own stated preference
("pino recommended over winston for lower overhead") — not a new arbitrary
choice. `pino-http` is mounted as the first middleware in `backend/index.js`,
giving every request a `req.id` and an automatic access-log line for free;
it's configured to skip `/healthz` so the 5s Docker/load-balancer poll doesn't
spam the log. A single `backend/src/logger.js` exports the base logger:
pretty-printed in dev, raw JSON in production (log-aggregator friendly,
matches `NODE_ENV=production`). All 42 call sites were converted to
`logger.info/warn/error/debug` with structured fields (`err`, `userId`,
`roomId`, etc.) instead of string concatenation.

**Two real bugs found and fixed along the way, not just mechanical swaps:**
- `backend/src/routes/user-delete.js` unconditionally logged the raw
  `req.fields` (including the target user's email) at what was effectively
  info level on every admin delete — leftover debug code, removed; replaced
  with a proper audit-style log line (`deletedUserId`, `byUserId`, no raw body).
- `backend/src/events/more-images.js`, `more-messages.js`, `more-rooms.js` all
  logged the copy-pasted, wrong string `'Received join room event'` on every
  pagination scroll — at info level, on a client-triggered event that fires
  constantly. Fixed the message and downgraded to `debug` (this is expected
  high-frequency traffic, not something worth info-level noise for).

**Trade-off:** No Redis-backed centralized log aggregation (e.g. shipping to
Loki/Grafana Cloud free tier) — out of scope for this pass and not required
by the ₹0-forever constraint since JSON stdout logs are already consumable by
any host's log viewer (Render, Docker, etc.) with zero extra infrastructure.
Add a shipper only if a real multi-instance deployment makes correlating logs
across processes necessary.

**Testing:** all 29 backend tests re-verified passing after the full
conversion; confirmed structured log output renders correctly during the
`socket-auth` test suite (visible `INFO` lines with `socketId`/`userId`
fields); manually booted the server standalone and confirmed clean structured
startup logs (`Chitcx server starting` → `Connected to DB`) with no crashes
across every touched file.

---

## D-022: Fixed missing `@theme` mapping — shadcn color utilities were never generated at all — 2026-08-16
**Decision:** Added an `@theme inline` block to `index.css` mapping every
`--background`/`--primary`/`--card`/etc. HSL-triplet token to Tailwind v4's
`--color-*` namespace (e.g. `--color-primary: hsl(var(--primary))`).

**The bug this fixes:** `index.css` defined the shadcn-convention HSL-triplet
tokens (`--primary: 240 6% 10%`, meant to be consumed as `hsl(var(--primary))`)
but never told Tailwind v4 those tokens *are* colors. Tailwind v4 only
generates a utility like `bg-primary` when a matching `--color-primary`
variable exists in its theme layer — defining `--primary` alone, with no
`@theme` block, means Tailwind has no idea `primary` is a color name at all.
Every shadcn component (`Button`, `Input`, `Checkbox`, etc.) references these
classes internally, so the practical effect was silent: buttons, inputs, and
cards render, but with zero background/foreground/border color — confirmed by
grepping the production CSS bundle for `--color-primary` and `bg-primary`,
both entirely absent from `dist/assets/*.css` before this fix. `rounded-full`,
spacing, and layout utilities were unaffected (Tailwind's built-in palette
doesn't need `@theme` mapping), which is exactly why this went unnoticed
through every earlier build/lint/test pass — nothing in that pipeline renders
pixels or asserts on computed color.

**How this was caught:** flagged by the user directly ("I dont think so
shadCN designs are applied to login register and home pages") after D-021's
work was reported complete. Verified by fetching the compiled dev-server CSS
and the production `dist/` bundle and confirming `bg-primary` was absent from
both; root-caused to the missing `@theme` block; fixed; re-verified present in
the rebuilt bundle (CSS output grew ~53KB → ~63KB, consistent with an entire
missing color-utility set now being generated).

**Lesson:** none of the existing verification (backend/frontend test suites,
`npx vite build` succeeding, eslint) catches a missing design-token mapping —
a build can succeed and every test can pass while the UI is fully unstyled,
because "compiles cleanly" and "looks right" are different claims. This class
of defect needs an actual visual check (dev server + browser, or a CSS-content
assertion like `grep -c "bg-primary" dist/**/*.css`) as a closing step for any
design-system work, not just code-level greps for leftover UIkit/Sass.

---

## D-021: Frontend test suite stood up (Vitest); caught two real bugs, including a build regression from D-020 — 2026-08-16
**Decision:** Added Vitest + React Testing Library (shares Vite's existing
config, no separate bundler setup). Three tests prioritized by risk, per
`TESTING-STRATEGY.md`'s own recommendation: `Message.jsx`'s bubble-grouping
logic, `BottomBar.jsx`'s offline-retry flow, `Login/index.jsx`'s `Tabs`-based
auth switcher. 17 tests across 3 suites, all passing.

**Bug #1, real and confirmed by the new test — not assumed:** `Login`'s auth
`Input` component was uncontrolled (accepted `onChange` but never `value`).
Switching from the Register tab back to Login lost whatever the user had typed,
because Radix `Tabs` unmounts inactive tab content by default and an
uncontrolled input's DOM-held value doesn't survive that unmount — even though
the React state (`email`/`password`) was tracking it correctly the whole time.
This is the exact same class of bug already found and fixed in
`ForgotPassword/components/Input.jsx` earlier in this project — missed in
`Login`'s sibling component at the time. Fixed by threading `value` through
both the wrapper and all 8 call sites in `Login/index.jsx`.

**Bug #2, more serious — a real production-build regression from D-020, caught
only because writing these tests forced a first full clean production build
since the shadcn migration finished:** removing `styled-components` in D-020
was based on "zero usages found in `src/`," which was true for this codebase's
own components but did not account for it being a genuine transitive peer
dependency of `react-data-table-component` (used by `Admin`'s user table).
Without it, `npx vite build` failed outright. Separately, `@emoji-mart/react`
(used by `BottomBar`'s emoji picker) has always been missing its
`emoji-mart` peer dependency — a pre-existing gap in the original codebase,
not something this session introduced, that also only surfaces on a full
production build. Both were reinstalled; both are confirmed necessary by the
build succeeding again.

**Why this matters more than the two fixes themselves:** D-020's own
verification claim ("build+lint+dev-server check after each" feature) was true
per-feature but never re-validated as a *whole-app* production build after
the very last dependency-removal step. A per-feature check can pass while the
full dependency graph is broken if the break is in a feature's own transitive
dependency, not its own source. **Lesson applied going forward:** a full
`npx vite build` from a clean state is now the closing step of any dependency
removal, not just a spot-check on the features believed to be affected.

**Tradeoff:** frontend test coverage is still narrow (3 files, not the whole
UI) — deliberately scoped to the highest-risk pieces per `TESTING-STRATEGY.md`
rather than attempting exhaustive coverage in one pass.

---

## D-020: 100% shadcn/ui + Tailwind migration, UIkit fully removed — 2026-08-16
**Decision:** Replaced every UIkit class and `.sass` file across all 13 frontend
features (NotFound, Welcome, Admin, Details, Group, Login, ForgotPassword, Panel,
Meeting, plus Conversation/Home/App which weren't in the original scope but still
depended on UIkit) with Tailwind utility classes and real shadcn/ui components.
Removed the `uikit` and `sass` npm dependencies entirely.

**Correction (found later, see D-021):** `styled-components` was also removed in
this pass on the belief it had zero usages in `src/` — true for this codebase's
own components, but it's a genuine transitive peer dependency of
`react-data-table-component` (used by `Admin`). Removing it silently broke the
production build; it had to be reinstalled. See D-021 for the full story and the
verification gap that let it through undetected.

**Options considered:**
1. Class-rename pass only (swap `uk-*` classes for Tailwind equivalents, keep UIkit's JS widgets) — faster, but leaves every dropdown/modal/toggle as inaccessible, unstyleable UIkit DOM.
2. Full replacement: real Radix-backed shadcn components (`Dialog`, `DropdownMenu`, `Tabs`, `Switch`) wherever a `data-uk-*` behavioral widget existed, plain Tailwind elsewhere.

**Chosen:** Option 2. Every real behavioral widget (7 dropdown menus, 4 modals, the
login/register tab switcher, the join-screen audio/video toggles) became genuine
Radix primitives — keyboard-accessible, no manual ARIA wiring needed. Trivial
UIkit flex/spacing classes became plain Tailwind utilities.

**Consolidation found along the way:** `Group/Create` and `Group/Create2`'s
`TopBar`/`SearchBar`/`User` sub-components were byte-identical duplicates (not the
"two genuinely different 2-step wizard components" they looked like from filenames
alone) — consolidated into `Group/components/`, cutting 6 files to 3.

**Tradeoff:** Large diff (13 features, ~40 component files touched), but done
feature-by-feature with a build+lint+dev-server check after each so no single
commit-worth of work was ever unverified.

**Measured result:** production CSS bundle **318KB → 53KB** (UIkit's theme fully
gone); JS bundle **~1.31MB → ~1.10MB** minified (UIkit's JS runtime removed).
See [`docs/CHITCX-DESIGN-SYSTEM-MIGRATION.md`](docs/CHITCX-DESIGN-SYSTEM-MIGRATION.md)
for the full component-by-component migration notes and bugs fixed along the way.

---

## D-019: Chitcx rebrand — env-driven, attribution kept honest — 2026-08-16
**Decision:** Renamed the product from Clover/Chattr to Chitcx across every
user-facing surface: page title, manifest, Docker container/network names, Mongo
database name, email-subject fallbacks, package names, and docs.

**What was NOT done:** claim authorship of the underlying template. The app is
built on a purchased CodeCanyon template ("Clover" by Honeyside) — confirmed via
live `codecanyon.net` links embedded in 6+ UI files at the start of this work.
README.md now carries an explicit attribution note; the original template's
`documentation.pdf` and `online.url` assets are kept and labeled as historical,
not rebranded to claim they're Chitcx's own.

**Removed, not rebranded:** the in-app CodeCanyon/Honeyside promotional links (5
files) and two dangling `honeyside.it` outbound links found later in `Admin` and
`NotFound`'s footer chrome — marketing chrome for the original template's demo
mode doesn't belong in a rebranded product, and attribution belongs in docs, not
a live outbound link in app footers.

**Bugs found and fixed during the pass (not rebrand-related, but touched the same
files):** a broken/commented-out logo in `Login/components/Logo.jsx` that rendered
a hardcoded personal name ("Adarsh Arya") instead of the actual logo+app name; a
hardcoded "© 2020" copyright year in `ForgotPassword`; a `Ringing.jsx` call screen
that always showed the literal string "Delta Honey" instead of the real caller's
name, despite computing the correct name one line above.

**Tradeoff:** Renaming the Mongo database name (`clover`/`crumble` → `chitcx`) is
a real breaking change for any existing deployment with data under the old name —
acceptable here since this is pre-launch, would need a migration step for a live
system.

---

## D-018: Low-network optimization pass — 2026-08-16
**Decision:** Added `compression` middleware (gzip/br on all API responses, one
line), debounced the typing indicator (was firing one HTTP POST per keystroke,
now max once per 1.5s) and search (was one request per keystroke, now 300ms
debounce) across every search bar in the app (Panel, Admin, Group, Meeting's
AddPeers — 4 separate call sites had the same bug).

**Verified as already correct, not a gap:** image sizing. The frontend already
requested the smallest viable size for inline display (256px avatars, 512px chat
thumbnails) and only stepped up to 1024/2048px for the explicit full-screen
lightbox — this was flagged as an open question in the original audit and
confirmed fine on inspection, not silently left broken.

**Why debounce over throttle:** typing/search are "wait for the user to pause"
signals, not "rate-limit a continuous stream" — debounce is the correct primitive,
not a stylistic choice.

**Tradeoff:** debouncing adds up to 300ms perceived latency on search results and
1.5s before a typing indicator appears remotely — acceptable given the alternative
was a network request per keystroke on connections this project explicitly targets
as slow/metered.

---

## D-017: Offline compose + retry-with-backoff for message sends — 2026-08-16
**Decision:** Text message sends now use a client-generated `clientID` (via
`crypto.randomUUID()`) instead of `Math.random()` masquerading as a Mongo
`_id`, wrapped in exponential backoff retry (1s/2s/4s, 4 attempts total). A
`MESSAGE_UPDATE` Redux action patches the optimistic bubble in place — swapping
in the real server `_id` on success, or marking `status: 'failed'` on exhausted
retries (previously: silent failure, no `.catch()` at all, bubble stayed
permanently "sent"-looking regardless of outcome).

**Why `clientID` instead of just fixing the `_id`:** using a fake value as `_id`
was the actual root cause of a latent bug — a `Math.random()` float could in
principle collide with cursor-pagination logic that reads `messages[0]._id`.
Introducing a separate, always-present `clientID` field removes that entire class
of risk instead of just making the fake ID "less wrong."

**Not done:** the same treatment for image/file sends (still use the old
fire-and-forget pattern). Documented inline as a `ponytail:` marker — upload retry
needs re-sendable `FormData`, a materially bigger change than retrying a JSON
POST, and wasn't reported as a problem worth solving preemptively.

**Tradeoff:** retries add up to ~7s of delay before a send is declared failed on a
badly broken connection — deliberate, since a network blip shouldn't surface as a
failure to the user if it would have succeeded on the next attempt.

---

## D-016: Real-time architecture — Socket.IO v2→v4, receipts, reconnect resync — 2026-08-16
**Decision:** Upgraded Socket.IO server+client from v2.5.0 to v4.8.3. Replaced
`socketio-jwt` (built for v2's connection-middleware shape, incompatible with v4)
with a ~20-line handshake built directly on the `jsonwebtoken` package already used
for HTTP auth — same wire protocol (`authenticate`/`authenticated` events), zero
frontend changes required, `socket.decoded_token` shape preserved so every
downstream consumer (mediasoup, socket event handlers) needed no changes.

Added: `Message.readBy` field + `POST /api/message/read` (membership-checked,
`$addToSet` for idempotency) for read receipts — previously fully absent. Added
`POST /api/messages/sync` (cursor resync via `_id: {$gt: lastMessageID}`, capped
at 200) for reconnect gap-filling — previously the client's one disconnect handler
listened for a nonexistent event name (`'disconnected'` instead of the real
`'disconnect'`), making it dead code; reconnects silently dropped any message sent
while offline until a manual room reopen.

**Explicitly deferred (confirmed with user, not silently skipped):** real
Socket.IO room joins (replacing the per-user-emit-loop broadcast pattern) and the
`@socket.io/redis-adapter` for multi-instance scaling. Both genuinely only pay off
once a second backend instance exists; the current hosting plan (D-011, Render
single instance) has no such need yet, and adding either now would be speculative
infrastructure with real new-bug surface (stale room joins on switch, an
Upstash/local-Redis dependency in local dev) for zero current payoff.

**Tradeoff:** the emit-loop broadcast pattern that was kept is O(n) per room
member instead of O(1) — acceptable at typical chat-room member counts, revisit
if the Redis adapter is ever added (real rooms become the natural prerequisite for
that, not before).

---

## D-015: Backend test suite stood up from zero, CI's silent no-op fixed — 2026-08-16
**Decision:** Added Jest + Supertest + `mongodb-memory-server` (no live DB
dependency in CI). 29 tests across 6 suites verify every P0 security fix as a
regression test (IDOR, author-spoofing, unauthenticated-endpoint, and the
`!x === y` operator-precedence admin-gate bypass — each has a test proving the
specific attack is now blocked, and the earlier working state that it isn't a
false positive).

**Bug found while building the harness:** an early version of the health-check
test monkey-patched `mongoose.connection.readyState` via `Object.defineProperty`
to fake a disconnected state — `readyState` is a prototype getter, not an own
property, and the monkey-patch hung the test process indefinitely. Root cause,
not just discovered by luck: rewrote the test to exercise two real connection
states via `mongodb-memory-server`'s actual connect/disconnect lifecycle instead
of faking internal library state.

**Fixed the CI-honesty gap:** `.github/workflows/ci.yml`'s backend job ran
`npm test --if-present`, which silently reports success when no `test` script
exists — exactly the failure mode a green CI badge is supposed to prevent. Now
runs a real `npm test` that fails the build on any test failure.

**Tradeoff:** frontend still has zero test coverage (no runner ever configured,
`setupTests.js` is dead CRA-era scaffolding) — flagged as known follow-up, not
silently left off this list.

---

## D-014: Database indexes, added with documented reasoning per index — 2026-08-16
**Decision:** Added `unique + sparse` indexes on `User.email`/`username` (closes
a real TOCTOU race in `register.js` — two concurrent registrations with the same
email could both pass the pre-save `findOne` uniqueness check before either
`.save()`'s), a plain index on `Message.room` (every message list/pagination/sync
query filters by room first), a compound `{people, lastUpdate}` index on `Room`
(covers `list-rooms.js`'s filter-and-sort in one index scan), and `shieldedID`
indexes on `Image`/`File` (every rendered image/file attachment does this lookup).

**Also fixed while touching this area:** `search.js` and `list-rooms.js` both had
the same unbounded-client-controlled-`limit` bug (`{"limit": 999999999}` was a
real DoS vector) plus `search.js` built a MongoDB regex directly from unescaped
user input (ReDoS + regex-injection risk) — both capped and escaped.

**Why `sparse`:** `email`/`username` aren't marked `required` in the schema;
a strict unique index without `sparse` would reject a second document with a
missing field (both nulls collide) — one keyword avoids that edge case instead of
adding custom validation code for it.

---

## D-013: P0 security fixes — IDOR, spoofing, and a silent admin-gate bypass — 2026-08-16
**Decision:** Fixed the confirmed vulnerabilities from the pre-work security audit
before touching anything else, on the reasoning that no other work matters if the
app is trivially exploitable.

**IDOR in `remove-room.js`:** any authenticated user could delete any room by ID,
zero membership check. Fixed by requiring the requester be a room member. The same
class of bug was also found in `get-room.js` during the fix (not in the original
audit) — same fix applied there too.

**Author spoofing in `message.js`:** `authorID` was read from the client-supplied
request body instead of the verified JWT (`req.user.id`) — any authenticated user
could post messages impersonating anyone. Fixed to always derive author identity
server-side; also added a missing room-membership check on the same route (a
non-member could previously post into any room by ID).

**Silent admin-gate bypass (found during the fix, not in the original audit):**
`user-edit.js` and `user-delete.js` both gated on `if (!req.user.level === 'root')`
— a JS operator-precedence bug (`!req.user.level` evaluates first, so the
comparison against `'root'` was always `false`, meaning the 401 branch never
fired). Any authenticated user could edit or delete **any other account by
email** — a real account-takeover path. Fixed to `req.user.level !== 'root'`.

**Also in this pass:** removed the hardcoded JWT fallback secret
(`config.js` now fails fast at boot if `AUTH_SECRET` is unset instead of silently
using `'jwt-default-secret'`), added rate limiting (`express-rate-limit`, stricter
budget on auth-adjacent routes), restricted CORS to a configured origin allowlist
(was wide-open, no options passed to `cors()`), added real file-upload validation
(size caps + MIME/extension checks — `upload-file.js` previously wrote any file
type to disk with a hardcoded `.jpg` extension regardless of actual content), and
authenticated two previously-open endpoints (`/api/rtc/peers`, `/api/meeting/get`)
that leaked peer data / allowed arbitrary meeting creation to anyone.

**Verification:** every fix above has a corresponding regression test (see D-015)
proving the specific attack is blocked — not just that the code was edited.

---

## D-012: E2EE deferred pending device-identity prerequisite — 2026-08-16
**Decision:** Do not implement E2EE yet. Threat model documented in full at
[`docs/E2EE-THREAT-MODEL.md`](docs/E2EE-THREAT-MODEL.md).

**Why deferred:** E2EE key management is inherently per-device, but the current auth
model (`backend/src/routes/login.js`) issues one long-lived JWT per login with no
device identifier in the token and no session/device record anywhere in the `User`
model. There is no natural place to attach a device's public key and no way to
detect a new device joining an account — a prerequisite gap, not a scoping choice.

**What must exist first:** a device-identity/session concept (JWT-per-device or
refresh-token-per-device, a device list). That is itself a real, scoped milestone
and should ship before E2EE is attempted, not alongside it.

**Also documented (see threat model doc for full reasoning):** what the server can/
cannot see post-E2EE, why group-room key distribution is harder than 1:1 and should
be a separate later milestone, why AI features (summarize/translate/draft-reply,
already built) must become explicit per-use plaintext opt-ins once E2EE ships
instead of operating on message content automatically, and the unresolved
new-device-history-access gap.

**Tradeoff:** Shipping a threat model instead of code here is intentional — a
partially-correct crypto implementation is worse than an honest, defensible "not
yet, here's why and here's what's next."

---

## D-011: Serv00 at capacity — Render promoted to active backend host — 2026-07-18
**Event:** Serv00 reached its user limit (170,000/170,000 accounts) as of July 2026.
Registration is closed; no automated notification when it reopens.

**Decision:** Render (already documented as fallback in `infra/render.md`) becomes the **active** backend host.
Serv00 remains the documented migration target — it is strictly better (always-on, SSH, Mediasoup-capable)
and will replace Render once a slot opens.

**Render sleep mitigation:** cron-job.org free tier (email signup, no card) pings `/healthz`
every 5 minutes, preventing Render's 15-minute idle sleep from triggering.

**To migrate to Serv00 later:** check https://www.serv00.com/register/ periodically (no email alerts).
When a slot opens, follow `infra/serv00.md` and update DNS CNAME `api` → new Serv00 URL.

---

## D-010: Glitch shut down — replace with Serv00 — 2026-07-18
**Event:** Glitch ended project hosting on July 8, 2025 ("Until we meet again" announcement).
`glitch.json` and `infra/glitch.md` tombstoned.

**Replacement chosen: Serv00** (https://www.serv00.com)

**Why Serv00 over alternatives:**
- **Always-on** (PM2 process manager, no sleep/hibernation) — unlike Render which sleeps after 15 min
- **No credit card** — email signup only
- **SSH access + full Linux** (gcc, python3, make available) — can compile Mediasoup native addon
- **Source code private** — unlike Glitch's public-project model
- **Free subdomain + Let's Encrypt TLS** via Serv00's panel web proxy
- **Cost**: $0 forever

**Limitation:** Registration closes temporarily when servers are full. When closed, use **Render** as fallback (sleeps after 15 min; mitigated with cron-job.org keepalive ping; no card required).

**New files:** `infra/serv00.md` (primary guide), `infra/render.md` (fallback guide).
**Tombstoned:** `glitch.json`, `infra/glitch.md`.

---

## D-009: Hard constraint — NO credit card, ever — 2026-07-18

**Constraint:** Zero credit cards used at any point in the stack, at any time.

**Services eliminated:** Oracle Always-Free (card for identity), Fly.io (card required), Heroku, DigitalOcean, Azure, Hetzner — all require a card.

**Final confirmed $0 stack:**
- Frontend: **Cloudflare Pages** (no card, unlimited static hosting)
- Backend API + Socket.IO: **Glitch.com** (no card, always-on, public project)
- WebRTC SFU (Phase 1): **local Docker** on dev machine (no cloud needed)
- Database: **MongoDB Atlas M0** (no card)
- Cache: **Upstash Redis** (no card)
- Storage: **Cloudflare R2** 10GB free (no card, zero egress)
- DNS/CDN: **Cloudflare free** (no card)
- CI/CD: **GitHub Actions** (no card)

**Code change:** `MEDIASOUP_ENABLED` env var added to `backend/index.js` and `backend/src/init.js`. When `false`, mediasoup is never `require()`d — so Glitch (no gcc/make/python3) never fails on the C++ native build. API-only mode: REST + Socket.IO + auth + chat all work normally.

---

## D-007: Infrastructure cost path — 2026-07-16

**Options considered:**
1. Path A — $0/month: Cloudflare + Atlas M0 + Upstash free + Fly.io free + Oracle Always-Free + GitHub Actions free
2. Path B — ~€4/month: same as Path A but Hetzner CX22 (€4.15/mo) instead of Oracle for the media host

**Chosen:** Path A — $0/month, permanently.

**Consequence:** Oracle Always-Free ARM (`VM.Standard.A1.Flex`) is the sole Mediasoup/coturn host. Hetzner CX22 is removed from all documentation. `infra/mediasoup-host.md` updated to Oracle-only with Oracle-specific VCN security list and iptables instructions.

**Tradeoff:** Oracle ARM (aarch64) requires that all native compiled packages (mediasoup, sharp, argon2) have ARM-compatible builds. Mediasoup 3.x supports ARM; sharp and argon2 both publish ARM binaries via npm. No code changes needed — Docker build on ARM automatically uses arm64 image layers.

---

## D-008: Eliminate Fly.io — consolidate backend API on Oracle Always-Free — 2026-07-16
**Problem:** Fly.io was the planned host for the Express/Socket.IO API. It is not reliably $0 — requires a credit card, charges on machine-hour or bandwidth overage, and the "free" tier has been reduced multiple times.

**Options considered:**
1. Koyeb free tier (0.1 vCPU / 512 MB) — too small; Socket.IO + Passport needs more RAM
2. Render free tier — sleeps after 15 min inactivity, kills persistent Socket.IO connections
3. Railway — requires $5/mo hobby plan after free trial ends
4. Oracle Always-Free ARM (already in stack) — 4 OCPU / 24 GB RAM, can trivially host the API alongside Mediasoup

**Chosen:** Run Express API + Socket.IO + Mediasoup on the **same Oracle Always-Free ARM instance**.

**Consequences:**
- `fly.toml` tombstoned (comment-only, points to `infra/mediasoup-host.md`)
- `docker-compose.prod.yml` added: removes frontend container in prod, adds Nginx service
- Frontend in production = `vite build` static output deployed to **Cloudflare Pages** (free, unlimited bandwidth for static assets)

**Tradeoff:** Single-host topology in Phase 1 — scaling is Phase 3/4's concern. This is correct for $0 budget at Stage 1 traffic.

---

## D-001: Docker Compose service topology — 2026-07-16
**Options considered:**
1. Single container (all-in-one) — simpler but breaks separation of concerns
2. Separate containers per service (backend, frontend, mongo, redis) — matches target prod topology

**Chosen:** Option 2 — four service containers mirroring the production multi-host topology.

**Tradeoff:** More compose configuration upfront, but means the same `docker compose up` habit a developer builds locally translates directly to understanding the production stack. Frontend container serves the Vite dev server locally; in prod it becomes a static build served by Nginx/Cloudflare Pages.

---

## D-002: Health check endpoint design — 2026-07-16
**Options considered:**
1. Simple `GET /healthz` returning `200 OK` always (liveness only)
2. `GET /healthz` checking DB connectivity and returning degraded state (readiness-aware)

**Chosen:** Option 2 — returns `{ status: "ok" | "degraded", db: "connected" | "disconnected" }`.

**Tradeoff:** A degraded response (DB down) returns HTTP 503, which Docker Compose healthcheck treats as unhealthy. This prevents dependent services from starting before the DB is ready. Adds a tiny overhead per health probe but catches real failure modes during startup ordering.

---

## D-003: Redis provider split (local vs staging/prod) — 2026-07-16
**Options considered:**
1. Upstash Redis everywhere (remote, even for local dev) — simpler config, one provider
2. Self-hosted Redis in Docker for local dev, Upstash for staging/prod — offline-capable dev

**Chosen:** Option 2 — Docker Redis locally, Upstash for deployed environments.

**Tradeoff:** Two Redis targets to configure, but local dev works without internet access and without consuming Upstash free-tier daily command quota during development iteration. Upstash free tier caps at 10K commands/day — acceptable through Stage 2 traffic, revisit at Stage 3.

---

## D-004: Frontend container strategy — 2026-07-16
**Options considered:**
1. Serve built frontend from the backend Express static middleware (current prod pattern)
2. Separate frontend container running Vite dev server in local Docker

**Chosen:** Option 2 for local Docker Compose. The backend still serves the built `dist/` in production. The Compose frontend container is Vite dev server for HMR during development.

**Tradeoff:** Slightly more complex compose file, but developers get hot-module replacement during local development rather than having to rebuild the frontend on every change.

---

## D-005: CI secret scanning tool — 2026-07-16
**Options considered:**
1. `gitleaks` — widely adopted, good GitHub Actions integration, detects committed secrets in git history
2. `trufflehog` — deeper entropy analysis, slower
3. GitHub's built-in secret scanning — only available on public repos or GitHub Advanced Security plans

**Chosen:** `gitleaks` via the official `gitleaks/gitleaks-action` action.

**Tradeoff:** gitleaks scans staged diff + full history on first run. Fast, no paid tier required for public or private repos using the action. Runs as a hard CI gate — fails the workflow if any secrets detected. Does not require a gitleaks config file for basic usage, though we add `.gitleaks.toml` for custom allowlists.

---

## D-006: Nginx TLS termination strategy — 2026-07-16
**Options considered:**
1. Cloudflare proxy (orange cloud) handles TLS for the web/API domain — zero-cert-management
2. Let's Encrypt on the server — full certificate control, no Cloudflare dependency

**Chosen:** Cloudflare-managed TLS for the main domain (`api.yourdomain.com`). Let's Encrypt via certbot on the Oracle Always-Free media host for direct TURN/media traffic (Cloudflare cannot proxy UDP/TURN ports).

**Tradeoff:** Split TLS strategy (two certificate sources) but each is optimal for its use case. Cloudflare's global CDN absorbs DDoS for the HTTP API path at zero cost; Let's Encrypt on the Oracle media box covers DTLS for WebRTC which bypasses Cloudflare by design. Both certificate sources are free.
