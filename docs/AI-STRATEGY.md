# Zeph AI — Strategy

Status: **implemented, backend + governance layer, frontend UI not yet
wired.** Seven features (summarize, translate, rewrite, draft-reply/smart
reply, title, topics), one primary cloud provider (Groq, Llama 3.1 8B
Instant), zero cost beyond the provider's free tier.

This document replaces the earlier Ollama-only AI strategy. See
`DECISIONS.md` (the entry superseding D-018's chat-assistant scope) for why
the primary provider changed, and `docs/ZEPH-AI-ARCHITECTURE.md` for the full
architecture, governance pipeline, and Big-O analysis.

## Design goal

`Zeph Client → AI API Gateway → Eligibility Engine → Quota/Abuse Protection →
Context Builder + Token Budget → Redis Cache/Dedup/Locks → BullMQ AI Jobs →
Groq API (Llama 3.1 8B Instant) → Output Validation → Cache/Persistence →
User`. Every requirement below follows from that pipeline, not from calling
an LLM endpoint directly.

## Provider: Groq (cloud, free tier), Ollama retained for Security AI

`backend/src/ai/provider.js` implements two adapters behind one interface
(`generate(prompt, options)`):

- **`groq`** (default target) — Llama 3.1 8B Instant via Groq's
  OpenAI-compatible Chat Completions API. Requires `GROQ_API_KEY`
  (server-side only, never sent to the frontend). Free tier, not unlimited —
  see "Cost control" below.
- **`ollama`** — local, self-hosted, no API key. Still used by the
  *separate* Security AI subsystem (`services/securityAi/`, Phase 6), which
  has its own `AI_SECURITY_ENABLED` flag and different privacy reasoning
  (security telemetry should not leave the deployment). Also selectable for
  the chat assistant via `AI_PROVIDER=ollama` if an operator prefers it.

`AI_PROVIDER` defaults to `none`. When unset, or when `AI_PROVIDER=groq` but
`GROQ_API_KEY` is missing, every AI route returns a clean `503
{ error: true, reason: 'AI_DISABLED', message: '...' }` — never a crash,
never a silent no-op. **Core Zeph functionality (messaging, calls,
authentication) never depends on AI being configured or available.**

## Why not self-hosted LLM infrastructure

Explicitly out of scope, per the project's zero-cost constraint: no GPU
hosting, no separate model-serving microservice, no vector database. Groq's
free tier does the actual inference; Zeph's own infrastructure (Redis,
BullMQ, MongoDB — all already deployed for other features) does governance
(eligibility, quotas, caching, deduplication, job queuing). See
`docs/COST-MODEL.md` and the Cost Control section of
`ZEPH-AI-ARCHITECTURE.md`.

## Eligibility before expense

The Eligibility Engine (`backend/src/ai/policy.js`,
`backend/src/ai/eligibility.js`) decides whether a request is *useful*
before any provider call — never "call Groq, then decide it was
unnecessary." Thresholds (minimum messages per feature, meeting duration,
summary freshness) are centralized in one policy object, not scattered
across route handlers. See `ZEPH-AI-ARCHITECTURE.md`'s Eligibility Rules
section for the full table.

## Privacy boundaries

- **No conversation memory beyond what's explicitly passed in.** Each
  request fetches that room's recent messages fresh, bounded by both a
  message-count cap and a token budget (`ai/contextBuilder.js`) — nothing is
  retained by the AI layer between calls beyond the durable summary cache
  itself (`ConversationSummary`, which stores only the generated summary
  text, not raw messages).
- **Input is token-bounded** (`AI_MAX_INPUT_TOKENS`, default ~4000) and
  **output is token-bounded** (`AI_MAX_OUTPUT_TOKENS`, default ~800) — see
  Phase 6 of `ZEPH-AI-ARCHITECTURE.md`.
- **Room-membership-checked** for every room-scoped feature (summarize,
  draft-reply, title, topics) — same authorization pattern as every other
  message-reading route in this codebase. `translate`/`rewrite` operate only
  on client-supplied text (no room access), so no membership check applies.
- **Rate-limited and quota-bounded** at multiple layers (per-user/minute,
  per-user/day, per-user-concurrent, per-IP/minute, global-concurrent — all
  Redis-backed, all configurable) on top of the existing `aiLimiter`
  express-rate-limit middleware in `init.js`. See Phase 5 of
  `ZEPH-AI-ARCHITECTURE.md`.
- **Secrets never reach the model or the logs**: `GROQ_API_KEY` lives only
  in `config.js`/env and the `Authorization` header of the outbound Groq
  request; it is never part of a prompt, a log line, or a frontend response.

## The E2EE interaction

Unchanged from the original design (carried forward, not re-litigated
here): **today, pre-E2EE**, the server has plaintext access to stored
messages already, so AI routes reading `Message.content` is not a new
exposure. **If/when E2EE ships**, AI features must become an explicit,
per-use, user-triggered plaintext opt-in — passive/automatic AI processing
of E2EE'd content must never happen. See `E2EE-THREAT-MODEL.md` §5.

## What's built (updated)

**Meeting summary** and **frontend UI** — both previously listed below as
not built — are now implemented. Meeting AI (client-side audio capture →
Groq Whisper transcription → eligibility → summary) is documented in
`docs/ZEPH-AI-ARCHITECTURE.md`'s Phase 14 section; frontend integration
(Summarize/Translate/Rewrite/Draft Reply/Topics/Meeting Recorder, all wired
into the real chat/meeting UI with loading/error/quota/cancellation states)
is documented in that same doc's Phase 10 section.

## What's not built

- **Hierarchical/incremental multi-pass summarization** and a vector
  database/RAG pipeline — YAGNI at portfolio scale. The context builder's
  recency-biased token-budget trim (Phase 6/10) keeps summaries useful for
  a conversation's current tail without a separate chunk-then-merge
  pipeline; build that only if an actual requirement (very long conversation
  histories) appears.
