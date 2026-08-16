# DECISIONS — Chattr Engineering Execution Plan

Architecture and design decisions with options considered, rationale, and tradeoffs.
Format: `D-NNN: Title — Date`

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
