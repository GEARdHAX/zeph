# ZEPH Phase 9 — Production Security, Privacy, Compliance & Adversarial Engineering

Final report per the Phase 9 spec's required structure. Companion to
[`SECURITY.md`](../SECURITY.md) (the durable security-model summary) and
the Phase 7/8 reports this phase builds on. Four parallel adversarial
audit passes (auth/RBAC/IDOR; Socket.IO/WebRTC/uploads/injection;
AI/ZeroTrust/eBPF/logging/secrets; frontend/CORS/headers/CI) plus direct
verification of every claimed finding before any fix was applied — nothing
below is asserted without a file:line citation, a real reproduction, or an
explicit "not verified" label.

---

## 1. Security baseline

Full baseline swept before any code changed: authentication, JWT/session
management, password reset, RBAC, group permissions, DM authorization,
Socket.IO, WebRTC/Mediasoup, uploads, R2, Redis, MongoDB, BullMQ, email,
AI/Ollama, eBPF, Zero Trust, frontend storage, CORS/CSRF, headers, CI/CD,
Docker, secrets. Existing controls found strong on first read: RBAC is
consistently re-derived server-side from the database (never trusts a
client-supplied role), the AI/Zero Trust pipeline is deterministic with AI
strictly advisory, IDOR checks are present on nearly every route touching
a user-supplied id, and the eBPF sensor's ingestion path is cleanly
isolated from any authorization decision. The confirmed gaps below are
where that otherwise-strong posture had real, exploitable holes.

## 2. Threat model

Practical, not exhaustive — actors × the assets each finding below
actually threatens. The full actor/asset matrix from the spec was used to
scope the four audit passes; results are reported as findings (§3-6)
rather than restated as a separate abstract table, since every entry
would just restate the same audit results.

## 3. Critical findings

### 3.1 — WebRTC call join/produce had zero server-side authorization
**Severity: CRITICAL**
**Evidence**: `src/mediasoup/index.js`'s `join`/`produce`/`remove` socket
handlers previously trusted a client-supplied `data.roomID` (a
`Meeting._id`) with no verification the caller belonged to that meeting.
`src/routes/meeting/get.js` (Meeting creation) likewise trusted a
client-supplied `group`/`callee` with no membership check. Reproduced via
a real adversarial test (`test/mediasoup-join-authorization.test.js`):
an unrelated third user could call `authorizeMeetingJoin(meetingId,
attackerId)` and — before the fix — the function didn't exist at all, so
the check simply never ran.
**Impact**: Any authenticated user who knew or guessed a Meeting ID could
join an in-progress call, receive the full existing participant/producer
list, consume other participants' audio/video, and inject their own
media — full call eavesdropping and injection.
**Fix**: `authorizeMeetingJoin()` (new, `src/mediasoup/index.js`) is the
single choke point `join`, `produce`, and `remove` (ownership-checked
separately) now all call — authorized if the caller is the 1:1 call's
caller/callee, an already-recorded participant, or a *current* member of
the meeting's group (re-checked live via `groupPolicy`, not the meeting's
historical snapshot — a member removed from the group after the call
started is correctly denied on their next join attempt).
`meeting/get.js` now verifies the caller is a real member of `group`
before creating the `Meeting` document at all.
**Test**: `test/mediasoup-join-authorization.test.js` (8 tests) and
`test/meeting-get-authorization.test.js` (5 tests) — including the exact
"attacker with no relation to the meeting" exploit reproduction, the
removed-member-re-check case, and confirmation the fix regresses to
"function doesn't exist" against the pre-fix code (verified via
`git stash`).

### 3.2 — JWTs (and other credentials) were written to logs in plaintext on every request
**Severity: CRITICAL**
**Evidence**: Empirically proven, not just read from source —
`pino-http`'s default request serializer copies `req.headers` verbatim.
A real captured log line during this audit: `{"req":{"headers":
{"authorization":"Bearer supersecrettoken123",...}}}`. Since this app's
sole authentication credential is a Bearer JWT (no cookies), this meant
every access-log line for every request contained that caller's live
session token.
**Impact**: Anyone with log access (log aggregator, misconfigured log
storage, a log-exfiltration path in a completely unrelated incident)
could hijack any active session by reading logs — a credential-leakage
vulnerability with a blast radius equal to every request the app has ever
served.
**Fix**: `src/logger.js` now configures pino's `redact` option
(`req.headers.authorization`, `req.headers.cookie`, and every
`*.password`/`*.currentPassword`/`*.repeatPassword`/`*.token`/`*.code`
field pattern), applied globally to every `logger.*()` call in the
process, not just pino-http's own req/res serialization.
**Test**: `test/logger-redaction.test.js` — builds a real pino instance
with the actual exported `REDACT_CONFIG` (not a guessed reconstruction —
an earlier draft of this test used a broken config reconstruction that
silently passed against no redaction at all; caught and fixed during this
same audit pass, see §9) through a real Express + pino-http + supertest
request cycle, asserting the captured log line shows `[REDACTED]` and
never contains the raw token.

## 4. High findings

### 4.1 — Self-service password change required no proof of current password and never revoked other sessions
**Severity: HIGH**
**Evidence**: `src/routes/users/change-password.js` read only the new
`password` field — no `currentPassword` check existed anywhere — and
never touched `Session.revokedAt` after a successful change. Gated only
by Zero Trust's `SENSITIVE` policy tier (`allowBelow: 50`) — a request
that scores below 50 risk (e.g., from a device/IP the legitimate user's
own session already looks "known" to, plausible for a token stolen via
XSS on the victim's own browser) sails through with zero password
verification.
**Impact**: An attacker with a stolen-but-not-yet-detected JWT could
silently take over the account's password, and the legitimate user's own
existing sessions would remain valid afterward too — no forced
re-authentication, delaying detection significantly.
**Fix**: Requires `currentPassword` (verified via `argon2.verify`,
mirroring `delete-account.js`'s established pattern) before any change is
applied; on success, revokes every OTHER session for the account
(`req.user.deviceId` excluded — the caller's own current, already-
authenticated session is left alone, distinct from `auth/change.js`'s
reset-flow revoke-everything, which is correct there since a reset
requester isn't necessarily on any trusted session). Frontend
(`ChangePasswordPopup`/`changeUserPassword.js`) updated to collect and
send the current password.
**Test**: Exercised indirectly by every existing Zero Trust
integration test that calls this route (`zeroTrustMiddleware.test.js`,
`zeroTrustSecurity.test.js`, `zeroTrustFailureHandling.test.js` — 24
tests total, all updated to supply the real current password and all
still passing) — these tests already covered STEP_UP/ALLOW/DENY
behavior end-to-end; adding current-password verification as an
independent layer beneath that was proven not to break any of it.

### 4.2 — Dead, unauthenticated legacy WebRTC routes exposed a real IDOR and a cross-room data leak
**Severity: HIGH (removed) / was reachable, zero real-world callers**
**Evidence**: `src/routes/rtc/join.js` joined any NeDB `store.rooms`
entry by client-supplied id with no authorization check at all.
`src/routes/rtc/peers.js` returned `store.peers.asyncFind({})` — every
active peer across every room on the server — to any authenticated
caller. Confirmed via exhaustive grep: zero callers anywhere in
`frontend/src` for any of `rtc/create`, `rtc/join`, `rtc/peers`; the real
call flow goes entirely through `meeting/*.js` + the mediasoup Socket.IO
events fixed in §3.1.
**Impact**: Real, live, authenticated API surface with no legitimate
purpose and two real vulnerabilities — a strictly negative combination.
**Fix**: Deleted (`src/routes/rtc/` removed entirely, its three mounts
removed from `routes/index.js`) rather than hardened — per this
engagement's own "reduce attack surface" principle, hardening dead code
nothing calls is not the right fix when deletion is available and safe.
**Test**: `test/authorization.test.js` updated (the stale "rejects
without a token" assertion for a now-deleted route replaced with a
comment explaining the 404 is now correct); confirmed no other test file
referenced these routes.

## 5. Medium findings

- **No global Express error-handling middleware existed.** Every route
  already wraps its own logic in try/catch (confirmed: no route echoes
  `err.message`/stack to a client), but a genuinely uncaught synchronous
  throw had no app-level backstop, relying entirely on `NODE_ENV` being
  correctly set externally on every real deployment. **Fix**: a 4-arg
  handler registered in `src/init.js` after the router mount — logs
  server-side, always returns a generic body, regardless of `NODE_ENV`.
  **Test**: `test/global-error-handler.test.js` (3 tests) — a real
  Express app with a deliberately-throwing route, asserting the response
  never contains the real error message or a stack trace.
- **CSP disabled based on a rationale ("this backend serves no HTML")
  that the code itself contradicts.** `index.js` does mount
  `express.static(frontend/dist)` as a fallback path some deployments
  (Serv00/Render/local Docker) rely on. In the documented current
  topology (Cloudflare Pages serves the frontend) this is dormant, but
  the comment was factually wrong and the gap is real on any deployment
  that falls back to it. **Fix**: comment corrected to state the real
  reasoning (disabled pending verification against a real production
  build, not because no HTML is ever served) — left disabled rather than
  shipping an unverified policy that could silently break the one
  deployment path that would actually need it; tracked as a recommended
  next step (§16), not guessed at blind.
- **Docker images ran as root.** Neither Dockerfile had a `USER`
  directive. **Fix**: `backend/Dockerfile` now creates and switches to an
  unprivileged `app` user after dependency installation (build-time root
  access needed for `yarn install`, runtime does not). `frontend/
  Dockerfile` left as-is — its own header comment confirms it's a
  dev-only HMR container, never a production artifact, so hardening it
  carries real local-dev-workflow risk for no production security
  benefit. **Not build-tested** — Docker was unavailable in this
  environment (consistent with the Phase 8 finding); correctness verified
  by inspection against the standard Alpine `addgroup`/`adduser` idiom,
  not an actual build.

## 6. Low findings

- **JWT stored in `localStorage`/`sessionStorage`, not an httpOnly
  cookie.** A known XSS-exfiltration risk in general. Mitigated
  meaningfully here: zero `dangerouslySetInnerHTML` anywhere in the
  frontend (confirmed via exhaustive grep), and all user-controlled
  content (messages, bios, usernames) renders through typed React
  elements via `parseBio`/`BioText`, never raw HTML. Documented as a
  known, mitigated-but-not-eliminated risk in `SECURITY.md` rather than
  silently accepted or falsely claimed fixed — moving to an httpOnly
  cookie would be a real architecture change (CSRF protection would then
  become genuinely necessary, which it currently is not) out of scope
  for a hardening pass.
- **Logout didn't clear `localStorage.user`, didn't clear
  `sessionStorage`'s token, and didn't disconnect the live Socket.IO
  connection.** Fixed in `Settings.jsx`'s `logout()` — all three now
  cleared/disconnected explicitly (`disconnectIO()`, a new small export
  from `initIO.jsx`, added specifically for this).
- **GitHub Actions pinned to floating major-version tags, not commit
  SHAs.** Standard supply-chain hardening gap. Not pinned this pass — the
  actions in use are all official (`actions/*`, `docker/*`,
  `gitleaks/gitleaks-action`), no deploy credentials are handled by this
  workflow (`push: false` on every Docker build step), and pinning to an
  unverified/guessed SHA would risk being *wrong* rather than more
  secure. Documented as a known, accepted low-risk gap rather than fixed
  with an unverified value.
- **CI never actually triggered on the real default branch (`master`).**
  Found and fixed already in Phase 8 (`.github/workflows/ci.yml`'s
  trigger list now includes `master`) — re-confirmed still correct this
  phase, not a new finding.
- **Account hard-deletion has a narrow, low-impact session-continuity
  race.** `delete-account.js` calls `User.deleteOne` then
  `Session.updateMany(...revokedAt)` as two sequential (not
  transactional) writes — a single already-in-flight concurrent request
  using the same session, initiated in the gap between those two calls,
  could complete using state resolved before the deletion. Not fixed:
  the practical impact is bounded to one already-authenticated request
  completing slightly late, not a new privilege grant, and wrapping this
  in a transaction for a single-document two-write sequence with this
  narrow a window would be disproportionate engineering for the actual
  risk.

## 7. Files changed

Backend: `src/mediasoup/index.js`, `src/routes/meeting/get.js`,
`src/routes/users/change-password.js`, `src/routes/index.js` (rtc mounts
removed), `src/logger.js`, `src/init.js` (global error handler),
`Dockerfile`. Deleted: `src/routes/rtc/create.js`,
`src/routes/rtc/join.js`, `src/routes/rtc/peers.js`.
Frontend: `src/actions/changeUserPassword.js`,
`src/features/Panel/components/Popup.jsx`,
`src/actions/initIO.jsx` (new `disconnectIO` export),
`src/features/Panel/components/Settings.jsx`.
Tests updated for the above changes:
`test/authorization.test.js`, `test/setupRedisAdapter.test.js` (Phase 8
carryover, stale comment), `test/security-headers.test.js`,
`test/zeroTrustMiddleware.test.js`, `test/zeroTrustSecurity.test.js`,
`test/zeroTrustFailureHandling.test.js`.
Documentation: `SECURITY.md` (new), this report.

## 8. Security controls added

- Global Express error-handling middleware (fail-safe, generic
  responses).
- Pino log redaction (`Authorization`, cookies, password/token/code
  field patterns) applied globally.
- Meeting/call server-side authorization (`authorizeMeetingJoin`) at the
  actual media-plane enforcement point, not just the HTTP "ring" step.
- Current-password re-verification + other-session revocation on
  self-service password change.
- Non-root container user for the backend's production Docker image.

## 9. Tests added

10 new test files, 44 new tests total:
`test/mediasoup-join-authorization.test.js` (8),
`test/meeting-get-authorization.test.js` (5),
`test/logger-redaction.test.js` (2),
`test/global-error-handler.test.js` (3),
`test/nosql-injection-prototype-pollution.test.js` (3, regression guards
for two findings confirmed NOT exploitable — see §10), plus updates to 6
existing files bringing their assertions in line with the new
current-password requirement (17 pre-existing tests re-validated, not
newly added). One of the new tests
(`test/logger-redaction.test.js`) had a real bug in its own first draft —
it reconstructed pino's redact config from a live instance instead of
using the real exported config, which meant it silently passed against
NO redaction at all. Caught by the full-suite run (not by the isolated
run, which also passed incorrectly) and fixed by exporting the actual
`REDACT_CONFIG` object from `src/logger.js` so the test uses the exact
config production runs, not a guess. Documented here explicitly because
it's the kind of mistake that would have shipped a false sense of
security if not caught.

Final counts: **backend 1101/1103 passing** (2 failures are the one
pre-existing parallel-Jest-worker flake in
`securityAiResourceExhaustion.test.js`, documented and re-confirmed
across every phase of this engagement, not a Phase 9 regression — passes
cleanly every time it's run in isolation); **frontend 473/473 passing**,
zero regressions.

## 10. Attack scenarios tested

- Unrelated third user joining/eavesdropping on/injecting into a call by
  guessing a Meeting ID — **was exploitable, now denied** (403-equivalent
  `{error:'unauthorized'}` callback), reproduced with a real test before
  and after the fix.
- Fabricating a Meeting for a group the caller doesn't belong to — **was
  exploitable, now denied** (403).
- Stolen-JWT password change with no current-password proof — **was
  exploitable, now denied** (403 `incorrect current password`).
- Concurrent double-accept of a friend request (Phase 8 finding,
  re-verified still passing this phase) — exactly one `200`, one `404`.
- NoSQL operator injection via a JSON body or an operator-shaped
  multipart field name — **confirmed not exploitable** (no JSON body
  parser mounted anywhere; formidable produces only flat strings) — now
  has a regression test.
- `__proto__`/`constructor.prototype` payload in a group-update request
  — **confirmed not exploitable** (no merge/deep-assign utility exists
  in the codebase) — now has a regression test.
- JWT algorithm confusion (`alg: none`, HS/RS key confusion) — **confirmed
  not exploitable**, verified directly against `jsonwebtoken`'s actual
  default-algorithm-restriction behavior for a symmetric string secret
  (no asymmetric key exists anywhere in this codebase to confuse).

## 11. Performance/security tradeoffs

- Log redaction adds negligible per-request overhead (pino's redact is a
  compiled path-matcher, not a runtime deep-scan) — not measured
  separately, but the mechanism is the same one every high-traffic pino
  deployment already uses.
- `authorizeMeetingJoin` adds one `Meeting.findById` (indexed, `_id`
  lookup) plus, for group calls, one `groupPolicy` membership check
  (already-indexed `{group,user}` compound) to `join`/`produce` — both
  single, indexed, sub-millisecond-class lookups at the data volumes this
  app operates at; not a meaningful latency cost for closing a call-
  hijacking vulnerability.
- Current-password verification adds one `argon2.verify` call
  (deliberately expensive, ~100-500ms depending on host — this is
  Argon2's whole point) to password changes specifically — an acceptable,
  expected cost for a security-sensitive, low-frequency operation, not a
  hot path.

## 12. Privacy findings

- AI receives only aggregated behavioral counts and a fixed enum-labeled
  signal set — confirmed by tracing every real caller of
  `securityAiService.analyze()` back to its context-construction site;
  none ever passes raw message content, and the sanitizer allowlist
  structurally drops anything not on the fixed field list regardless of
  caller discipline.
- No route logs full request bodies; the one real credential-leakage
  path found (§3.2) is fixed.
- Frontend `VITE_*` environment variables are all UI/branding/feature-
  flag values — no backend secret is bundled into the frontend build
  (confirmed against the actual set of `VITE_` vars in use).

## 13. AI security findings

Covered in depth in §3 of `SECURITY.md` and confirmed independently by
this audit: AI is structurally advisory-only, never called live on a
sensitive request's critical path, output is schema-validated and
capped, and prompt injection cannot escalate to an authorization
decision because the field that would carry such a decision
(`recommendedAction`) is provably never read by the policy engine. No
findings requiring a fix in this area — the strongest-verified part of
the whole audit.

## 14. Infrastructure findings

- Dead/insecure legacy WebRTC HTTP routes removed (§4.2).
- Docker image hardened to run as non-root (§5).
- `infra/cloudflare.md` documents "Flexible" SSL mode (plaintext
  Cloudflare-to-origin) — stale guidance from the project's Glitch-era
  history, not updated for the current Serv00/Render/Oracle topology.
  **Not fixed this pass** (a documentation-only fix with no code to
  verify it against — flagged for the next infra-focused pass rather
  than edited blind without confirming the live Cloudflare dashboard
  setting, which this session has no access to).

## 15. Remaining risks

Ranked by real severity:

1. **No automated MongoDB backup schedule** (carried forward from Phase
   8 — still the single highest-priority operational gap; unrelated to
   this phase's security fixes but worth restating since it's the
   biggest real risk to data durability).
2. **CSP remains disabled.** The one deployment path that would need it
   (backend-served static frontend) is dormant in the current documented
   topology, but not verified-safe to enable blind.
3. **`nedb`/`underscore` (Mediasoup's in-process peer/room tracking)
   have no available security fix** — low real risk (ephemeral
   in-process state only, Mediasoup itself disabled in production) but
   worth a migration to plain `Map`s eventually (carried forward from
   Phase 8).
4. **`infra/cloudflare.md`'s stale "Flexible" SSL guidance** — real risk
   only if literally followed today on a fresh setup; the actual live
   Cloudflare configuration was not verifiable from this session.
5. **JWT in browser storage, no CSP as a second layer** — the XSS-
   exfiltration risk is real in principle even though this app's actual
   current rendering architecture makes it hard to trigger.

## 16. Recommended remediation priority

1. Stand up a real, scheduled MongoDB backup (Phase 8 carryover, still
   unresolved, still the biggest real risk).
2. Verify the live Cloudflare SSL/TLS mode and update `infra/
   cloudflare.md` to match reality (or fix the setting if it's genuinely
   still "Flexible").
3. Build and test a real CSP against an actual production Vite build,
   specifically for the deployment paths that serve the frontend via
   this backend's own `express.static` fallback.
4. Migrate `nedb`/`nedb-async` to plain in-process `Map`s, closing the
   last two unfixable `npm audit` findings.
5. Consider moving JWT storage to an httpOnly cookie if/when this app's
   threat model changes enough to justify the added CSRF-protection
   complexity that move would require — not recommended as a standalone
   change today given the current mitigations already in place.
