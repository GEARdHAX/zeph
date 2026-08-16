# Testing Strategy — Chittx

Status: **backend covered, frontend not yet.** This doc states what exists, what
doesn't, and why — not an aspirational checklist.

## What exists

**Backend: 29 tests across 6 suites** (Jest + Supertest + `mongodb-memory-server`,
no live DB dependency — CI needs nothing beyond `npm ci && npm test`).

| Suite | What it proves |
|---|---|
| `authorization.test.js` | Every P0 security fix, as a regression test: IDOR on room delete/get, author-spoofing on message send, the two previously-unauthenticated endpoints now reject unauthenticated requests, the `!x === y` admin-gate bypass is closed |
| `search.test.js` | Regex-injection input is treated as literal text, not a pattern; client-supplied `limit` is capped server-side |
| `message-read-and-sync.test.js` | Read receipts are membership-checked and idempotent; reconnect resync returns only messages after the given cursor and is also membership-checked |
| `health.test.js` | `/healthz` reflects live Mongo connection state, not a stale boot-time flag |
| `ai.test.js` | AI routes fail closed (503) with no provider configured; membership-checked when enabled; a provider failure returns 502 instead of crashing (verified via a mocked `fetch`, no live Ollama needed in CI) |
| `socket-auth.test.js` | The Socket.IO v4 handshake (replacing `socketio-jwt`) authenticates valid tokens, rejects invalid ones, and correctly delivers a targeted emit to the authenticated user's personal room |

**Why this set specifically:** every test here exists because it proves a
*specific, previously-confirmed* bug is fixed — not generic coverage for its own
sake. If a test in this suite fails, it means a real regression, not a fragile
assertion about implementation detail.

**CI honesty:** `.github/workflows/ci.yml`'s backend job runs a real `npm test`
that fails the build on any test failure. Previously ran `npm test --if-present`
with no `test` script defined — silently green, testing nothing. See D-015 in
`DECISIONS.md`.

## What does not exist

**Frontend has zero automated test coverage.** `setupTests.js` is dead
Create-React-App-era scaffolding, never wired into this Vite project — `jest` and
`@testing-library/jest-dom` aren't even installed. The frontend CI job's
`npm test --if-present` is a no-op for the same reason as the backend one was
before D-015, just not yet fixed on this side.

This matters more than it might for a typical CRUD frontend, because this
migration pass rewrote ~40 component files in a single session (see
`CHITCX-DESIGN-SYSTEM-MIGRATION.md`) with no automated check beyond production
build + lint + manual dev-server verification. That's real but weaker evidence
than a test suite — a build/lint pass proves the code is syntactically valid and
type-safe-ish, not that a given user flow still behaves correctly.

**Recommended next step, not yet done:** Vitest (shares Vite's existing config,
no separate bundler setup needed) + React Testing Library, prioritized by risk:

1. `Message.jsx`'s bubble-grouping logic (`attachPrevious`/`attachNext`) — the
   most intricate conditional rendering in the migrated UI, easy to silently
   break with a future edit.
2. `BottomBar.jsx`'s offline-retry flow — `clientID` generation, the
   `MESSAGE_UPDATE` patch on success/failure, retry exhaustion behavior.
3. `Login/index.jsx`'s `Tabs`-based auth flow — confirm switching tabs doesn't
   leak state between login/register forms.

## Real-time / integration testing

`socket-auth.test.js` is the only real-time integration test that exists — it
boots an actual `http.Server` + `socket.io.Server`, connects a real
`socket.io-client`, and exercises the genuine `initSocketAuth` code path (not a
mock). This pattern (real server, real client, no mocking of the thing under
test) should be the template for any future real-time test — a mocked socket
proves the mock behaves as configured, not that the real handshake works.

**Not tested:** multi-instance behavior (no Redis adapter exists yet — see D-016,
deliberately deferred), reconnect-and-resync as an end-to-end flow (the
`sync-messages` route is tested in isolation; the client-side trigger logic in
`initIO.js` is not).

## Benchmark scripts (not correctness tests, but part of the verification story)

Three scripts exist under `backend/scripts/` and `frontend/scripts/`
(`bench.js`, `bench-reconnect.js`, `bench-bundle.js`) that measure API latency,
Socket.IO reconnect-handshake timing, and production bundle size respectively —
all against real code paths, no mocks. These aren't pass/fail tests; they exist
so a future change can be compared against a concrete before/after number instead
of "it feels faster." See each script's own header comment for what it measures
and why.
