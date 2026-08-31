# Security

This document describes zeph.'s security model, what it protects against,
where the boundaries are, and how to report a vulnerability. It is written
from a real Phase 9 adversarial audit (see
`docs/PHASE9-SECURITY-REPORT.md` for the full findings) — every claim here
is backed by code, a test, or an explicit "not verified" statement, not
aspiration.

## Reporting a vulnerability

This is a portfolio project, not a company with a formal bug bounty. If
you find a real security issue, open a private report (GitHub's "Report a
vulnerability" under the Security tab if available, otherwise a direct
message to the maintainer) rather than a public issue — give a
reasonable window to fix it before public disclosure. Do not test against
the live production deployment with anything destructive; a local
`docker-compose up` gives you the same app against throwaway data.

## Authentication model

- **Bearer JWT, not cookies.** Every authenticated request carries
  `Authorization: Bearer <token>`. No session cookie exists, so classic
  CSRF (which relies on the browser auto-attaching an ambient credential)
  does not apply to this app's actual threat model — a cross-site
  request cannot construct that header without JavaScript already running
  same-origin, which is an XSS problem, not a CSRF one.
- **HS256, symmetric secret (`AUTH_SECRET`).** No RSA/EC key exists
  anywhere in the codebase, which structurally closes the classic JWT
  algorithm-confusion attack (there is no public key to misuse as an
  HMAC secret) — confirmed against `jsonwebtoken`'s actual default
  behavior, not assumed.
- **Server-side revocation via `Session` documents.** `Session._id`
  doubles as the JWT's `deviceId` claim. Logout, password change/reset,
  and account deletion all set `Session.revokedAt`; every authenticated
  request (HTTP and Socket.IO) re-checks this on every call — a token
  is only as valid as its underlying session, not merely "not expired."
- **Password hashing: Argon2id.**
- **Zero Trust risk-based step-up** sits in front of sensitive actions
  (password change, account deletion, session management, group
  creation/role changes/bans). It computes a deterministic risk score
  from session age, recent failed logins, recent permission denials, and
  optional threat-intelligence/AI-anomaly signals, then returns
  ALLOW / STEP_UP / DENY. **AI is never authoritative here** — see below.

## Authorization model

- **RBAC is server-side only, always re-derived from the database.**
  Every privileged group action (role change, ban, ownership transfer,
  deletion) looks up the actor's current `GroupMember` row fresh on every
  request — a client-supplied role/level value is never trusted for an
  authorization decision anywhere in this codebase (verified by grep
  across every route).
- **IDOR/BOLA**: every route that reads a user-supplied id (room,
  message, media, session) verifies the requester's membership/ownership
  against the database before returning or mutating anything. Legacy
  `/api/images/:id` and `/api/files/:id` are the one deliberate exception
  — a known, documented security-by-obscurity gap for content uploaded
  before the current `Media`-model authorization path existed (see
  `docs/PHASE9-SECURITY-REPORT.md` for the accepted-risk reasoning).
- **WebRTC/call authorization is verified server-side at the media
  layer, not just at the "ring" step.** As of Phase 9, joining, producing
  media into, and consuming from a call all require the caller to be a
  real participant of the underlying `Meeting` (1:1 caller/callee, a
  recorded participant, or a current member of the meeting's group) —
  this was a real, fixed gap; see the Phase 9 report for the full
  before/after.

## AI security boundaries

- **AI is advisory only. It can never grant, deny, or directly influence
  an authorization decision.** The Zero Trust policy engine's
  ALLOW/STEP_UP/DENY output is a pure function of deterministic signals;
  an AI-derived signal contributes at most a small, fixed, confidence-
  gated point value to a risk score — it is never read as a decision
  itself, and a schema-validated `recommendedAction` field the model
  could theoretically return is explicitly never consumed by the policy
  engine.
- **AI is never called live on a request's critical path.** The risk
  engine only ever reads a pre-computed, cached AI verdict (populated
  earlier by a background job or an admin's manual analysis) — an
  Ollama outage, timeout, or malformed/adversarial response degrades to
  "no AI signal," never a blocked or delayed authorization check.
- **AI never receives raw user content.** Message text, passwords, JWTs,
  reset codes, and credentials are never part of any AI prompt — the
  security-AI pipeline's sole input path is a hard allowlist of
  aggregate behavioral counts and a small fixed set of enum-labeled
  signals; anything not on that allowlist is silently dropped before it
  can reach a prompt.
- **Prompt injection cannot escalate privilege.** A malicious/adversarial
  Ollama response (including one containing literal text like
  `"ALLOW"`) either fails schema validation and is discarded, or is
  accepted as an advisory label with zero effect on the actual
  authorization outcome — confirmed by tracing that the policy engine
  never reads that field.

## Data & privacy

- **MongoDB is the sole durable source of truth.** Redis is cache,
  pub/sub, and coordination only — never consulted for an authorization
  decision, and every rate limiter in this app is in-memory (not
  Redis-backed), so a Redis outage cannot make a limiter silently
  unlimited (there was never a dependency to lose).
- **Logs never contain credentials.** Every log call in this codebase
  uses structured pino logging with an explicit `redact` configuration
  covering the Authorization header, cookies, and every password/token/
  reset-code field — confirmed with a real captured log line before and
  after the fix (see the Phase 9 report; this was a genuine, fixed gap).
- **Account/group deletion is immediate at the authorization layer.** A
  deleted group is marked inaccessible synchronously, before any
  asynchronous cleanup runs — every route that touches a group checks
  that flag, so a delayed cleanup job can never leave a window where a
  "deleted" resource is still reachable.

## Known limitations (stated honestly, not hidden)

- **Single-instance rate limiting.** Every rate limiter is in-process
  memory, correct for the current single-instance deployment but not
  distributed — documented, with the upgrade path (Redis INCR+EXPIRE)
  already noted in the relevant source files, not built speculatively.
- **No Content-Security-Policy.** Disabled pending verification against
  a real production build — see `docs/PHASE9-SECURITY-REPORT.md` for
  why an unverified policy was judged riskier than none, for now.
- **TURN/coturn is not deployed.** Calls behind restrictive
  NAT/firewalls may fail to establish media; `infra/coturn.conf` is a
  template for a future deployment, not live infrastructure.
- **No automated MongoDB backup schedule** exists for the production
  database today (MongoDB Atlas's free tier does not include continuous
  backup). A manual/scheduled `mongodump` process is a known,
  recommended next step — the restore *mechanism* has been verified
  (Phase 8), the backup *schedule* has not yet been built.
- **JWTs live in `localStorage`/`sessionStorage`**, not an httpOnly
  cookie — a known XSS-exfiltration risk in general, mitigated here by
  the app never using `dangerouslySetInnerHTML` and consistently
  rendering user content through typed React elements rather than raw
  HTML (verified, not assumed) — but there is no CSP as a second layer
  of defense against that specific risk today (see above).

## What this document does not claim

zeph. is not independently audited, certified, or "penetration tested" by
a third party. No claim here is a substitute for your own review before
trusting this codebase with anything sensitive. "Fixed" means a specific,
cited change with a reproducible test proving the before/after behavior —
never a general assurance that the system as a whole is unhackable.
