# AI Assistant Strategy — zeph.

Status: **backend implemented, frontend UI not yet wired.** Three features
(summarize, translate, draft-reply), one local provider (Ollama), zero cloud API
keys anywhere in the codebase.

## Design goal

The plan's own framing: `Chat → AI Assistant service → provider abstraction →
configured provider OR disabled`. Every requirement below follows from taking
that diagram literally rather than treating it as a suggestion.

## Provider: local only, by design, not as a placeholder for "add OpenAI later"

`backend/src/ai/provider.js` implements exactly one real provider — Ollama,
self-hosted via Docker (`docker compose --profile ai up`, not started by
default). No cloud AI provider exists in this codebase.

This wasn't the default choice — see D-018 in `DECISIONS.md` and
`COST-MODEL.md` for the full reasoning — but it's worth restating here because
it's the single decision that makes every other requirement below trivially
true instead of aspirational:

- **No API key exists to expose to the frontend**, because there's no cloud
  provider that issues one. The "don't expose API keys in the frontend"
  requirement is satisfied by construction, not by careful handling of a secret.
- **No per-token billing risk**, because there's no metered API being called.
- **No dependency on a third party's uptime or rate limits.**

Adding a second, cloud-based provider later means adding one more branch to
`getProvider()` — the interface (`generate(prompt)`) doesn't change. That's a
real future option, not a foreclosed one; it just isn't the default.

## Fails closed, not open

`AI_PROVIDER` defaults to `none`. When no provider is configured,
`buildAssistant(config).enabled` is `false`, and every AI route
(`/api/ai/summarize`, `/api/ai/translate`, `/api/ai/draft-reply`) returns a
clean `503 { error: true, message: 'AI features are not enabled on this
server.' }` — not a crash, not a silent no-op, not a degraded experience that
looks broken. **The application is fully functional with zero AI configured**;
this was verified with a test (`test/ai.test.js`), not just asserted.

## Privacy boundaries

- **No conversation memory beyond what's explicitly passed in.** Each call to
  `summarize`/`draftReply` sends only the specific room's recent messages
  (capped: 50 for summarize, 20 for draft-reply) fetched fresh for that one
  request — nothing is cached, logged, or retained by the AI service layer
  itself between calls.
- **Input is bounded** (`MAX_INPUT_CHARS = 4000` in `assistant.js`) — this is a
  chat assistant operating on a specific, scoped request, not an open-ended
  completion endpoint that could be handed arbitrarily large or unrelated text.
- **Room-membership-checked**: `summarize` and `draftReply` verify the requester
  is a member of the room before touching its messages — same authorization
  pattern as every other message-reading route in this codebase, not a special
  case. `translate` operates only on client-supplied text (no room access), so
  no membership check applies there.
- **Rate-limited separately and more strictly** than general API traffic (15
  requests / 15 min vs. 300 / 15 min) — AI calls are slower and more
  resource-intensive even against a local model, and deserve a tighter budget
  regardless of cost, since they're the most expensive request type this
  backend serves.

## The E2EE interaction (the part that actually required design work)

This is the one place "keep AI simple" and "the plan wants E2EE eventually"
genuinely conflict, and it's worth being explicit about the conflict rather than
leaving it implicit.

**Today, pre-E2EE:** `summarize`/`draftReply` read `Message.content` directly
from MongoDB — the server already has plaintext access to stored messages, so
these routes reading it is not a new exposure.

**If/when E2EE ships** (see `E2EE-THREAT-MODEL.md` — not yet implemented,
blocked on a device-identity prerequisite that doesn't exist yet): the server
will no longer have plaintext message content to read at all. At that point,
`summarize`/`draftReply` **must become an explicit, per-use, user-triggered
plaintext opt-in** — the client decrypts locally, and *at the moment the user
clicks "summarize this conversation"* sends that specific plaintext to the AI
route for that one call. The server still never stores or logs it, but the user
has explicitly chosen to let that one request be processed in the clear.
**Passive or automatic AI processing of E2EE'd content must never happen** —
that would silently defeat the entire point of E2EE for any room where these
features are used.

This requirement is recorded in `E2EE-THREAT-MODEL.md` (§5) as a constraint on
the E2EE design, and recorded here as a constraint on the AI design — the two
docs should stay in sync if either changes.

## What's not built yet

Frontend UI for triggering summarize/translate/draft-reply doesn't exist —
the backend routes are complete and tested, but there's no button/panel in the
chat UI that calls them. This is a deliberate "backend-compatible plumbing now,
UI later" sequencing choice (same pattern used for read receipts and reconnect
resync earlier in this project), not an oversight.
