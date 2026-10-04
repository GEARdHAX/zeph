# CDN architecture for uploaded assets

Cloudflare Worker (edge) in front of a **private** R2 bucket, with signed URLs minted by the Render backend. Written 2026-10-04 after inspecting the existing upload and serving code.

## 1. Current architecture (verified in code)

| Question | Answer |
| --- | --- |
| Where are files uploaded? | Chat attachments: `POST /api/upload/media/presign` then the browser PUTs straight to R2, then `POST /api/upload/media/:id/complete` validates it (sniff, archive check, thumbnail). Already direct-to-R2. Profile/room pictures: `POST /api/upload` through Node (formidable, then `sharp` makes sized copies, then R2). Legacy `upload/file` and `upload/media` proxy paths remain as the non-R2 fallback. |
| Do uploads already use R2? | Yes, when `R2_*` is set (`storage.js`, with a local-disk fallback otherwise). |
| How are file URLs generated? | They aren't signed. The frontend builds `/api/media/:id` (chat) and `/api/images/:shieldedID/:size` (pictures, legacy images) and `/api/files/:id` (legacy files). |
| How does auth work? | `/api/media/:id` needs a JWT plus a room-membership check, so the frontend fetches it with axios as a blob (`useAuthorizedMediaUrl`). `/api/images` and `/api/files` are unauthenticated: access depends on an unguessable 120-character shieldedID (documented, accepted gap in `DECISIONS.md`). |
| Which routes serve files directly? | `media.js`, `images.js`, `files.js`. All stream the object **through Node on Render**. None set `Cache-Control`; none support `Range` (video seeking is poor). Direct uploads also store no `mimeType`, so they are served as `application/octet-stream`. |
| Existing Cloudflare config? | None for assets. `api.zephchat.tech` shows `Server: cloudflare` only because Render fronts itself with Cloudflare. `zephchat.tech` DNS is at the registrar, not in a Cloudflare zone. |

Problems: every byte of every download uses Render CPU and bandwidth, nothing is cached, no Range support, avatars refetch on every load.

## 2. Target architecture

```
Browser ──signed URL──▶ Cloudflare Worker (edge: TLS, HMAC check, cache) ──R2 binding──▶ R2 (private)
   ▲                                  ▲
   └── Render backend: authenticates, authorizes, mints signed URLs ──(shared HMAC secret)
```

- **R2 stays private.** The Worker reads it through an R2 *binding*, not S3 credentials. The S3 endpoint and keys never leave Render.
- **The backend decides who may read; the Worker only checks the signature.** They share one secret (`CDN_SIGNING_SECRET`).
- Uploads are unchanged (already direct to R2).

## 3. Flows

**Upload (chat attachment, unchanged shape):** client, JWT, backend validates type/size and creates the key, returns a presigned PUT, client PUTs to R2, `complete` validates and marks READY. New: `complete` checks the real object size against the category limit (`HEAD`) and stores the `mimeType`.

**Public asset (avatars, room pictures, new images via `/api/images`):** client requests `/api/images/:id/:size` (the URL the frontend already uses), backend answers `302` to `https://<cdn>/o/public/...?exp=0&sig=...`, the Worker verifies the signature, then edge cache HIT returns immediately, MISS reads R2 and caches (`public, max-age=31536000, immutable`).

**Private asset (chat media):** client calls `GET /api/media/:id/url` with its JWT, backend runs the existing room-membership check and returns `{ url, expiresAt }`, the browser loads that URL straight from the Worker, which verifies signature and expiry, then serves from R2 with `Cache-Control: private` (never in a shared cache). Range requests work, so video seeking works.

## 4. Security model

1. R2 credentials stay in Render. The Worker holds only the signing secret (a Wrangler secret) and the R2 binding.
2. **Visibility is fixed by the key prefix and enforced twice.** `public/...` and `private/...` only. The backend refuses to sign across the line, and the Worker rejects any other prefix (so old keys, `healthcheck/` and anything unexpected return 404).
3. Signature = HMAC-SHA256 over `version, key, exp, disposition, filename, contentType`. Changing any field invalidates it. Public URLs sign `exp=0` (deterministic, so they cache); private URLs carry a real expiry and the Worker rejects expired or too-far-future values.
4. The signature is verified **before** any cache lookup, so an unauthorized request can never be answered from cache. Only verified public GETs are cached, keyed by the normalized `origin/path`.
5. Private responses are never stored in a shared cache. Public responses use `Access-Control-Allow-Origin: *` (safe: no credentials) so a cached copy can't carry one origin's CORS answer to another.
6. `Content-Type` comes from the signed value, `Content-Disposition: attachment` is forced for document/archive/text, and `X-Content-Type-Options: nosniff` is always set.
7. Keys are validated against a strict character set (no `..`, `//`, leading slash).
8. Logs never contain signed URLs, secrets or tokens. Unauthorized media access is logged with user and media id only.
9. Honest trade-off: a signed private URL is a bearer link until it expires (default 1 hour, `CDN_PRIVATE_URL_TTL`). One hour so long videos keep working; lower it if you prefer. Public avatars are exactly as exposed as before (unguessable id), now behind a backend-minted signature.

## 5. Cache strategy

| Asset | Header | Why |
| --- | --- | --- |
| Public (avatars, pictures) | `public, max-age=31536000, immutable` | A new picture is a new shieldedID and therefore a new key; never purge. |
| Private (chat media) | `private, max-age=300` | Browser-only, short. Never shared. |
| The `302` from `/api/images` | `public, max-age=3600` | Lets browsers skip the Render hop for an hour. |

Edge caching needs a **custom domain on a Cloudflare zone**: Cloudflare's Cache API does not work on `*.workers.dev`. Until the domain is routed, the Worker runs uncached (everything else, including Range and security, works) and the browser still caches via the immutable header. The code detects `*.workers.dev` and skips the cache by itself.

## 6. Cloudflare configuration (you do this)

1. `cd cdn-worker`, `npx wrangler login`.
2. `npx wrangler secret put CDN_SIGNING_SECRET` (use a long random value; use the same one on Render).
3. Edit `wrangler.toml` `ALLOWED_ORIGINS` (your frontend origins) if needed, then `npx wrangler deploy`. Note the `https://zeph.<you>.workers.dev` URL.
4. Optional, enables edge caching: move `zephchat.tech` to Cloudflare DNS (copy every existing record first: `www` to Vercel, `api` to Render, any MX/TXT mail records), then add a Worker route/custom domain `cdn.zephchat.tech`.
5. R2 bucket stays private: do **not** enable `r2.dev` or a public custom domain on the bucket.
6. **Bucket CORS (required for uploads).** Browsers upload straight to R2 with a presigned link, and without a CORS rule on the bucket the browser blocks it before it starts (the preflight gets a 403). Apply `cdn-worker/r2-cors.json` once: `cd cdn-worker && npx wrangler r2 bucket cors set zeph-uploads --file r2-cors.json`. It allows only `PUT`, only from the site's origins (`https://www.zephchat.tech`, `https://zephchat.tech`, `http://localhost:5173`); add any new frontend origin to that file and re-run the command. Downloads never touch R2 directly (they go through the Worker), so no GET rule is needed.

## 7. Backend changes

New `src/cdn.js` (sign and build URLs), new `src/storageKeys.js` (key scheme), `storage.js` gains `getObjectMetadata` and `objectExists`. Routes: `media.js` adds `/:id/url` and `/:id/thumbnail/url`, `images.js` redirects public keys to the CDN, `upload.js` / `upload-media.js` / `upload-media-presign.js` use the new key scheme, `upload-media-complete.js` verifies the real size and stores `mimeType`, `info.js` reports `cdnEnabled`. The frontend hook `useAuthorizedMediaUrl` asks for a signed URL first and falls back to the old blob path when the CDN is off.

Key scheme (not the original filename, no sensitive data): `public/users/{userId}/avatar/{id}.jpg` (+ `-{size}.jpg`) and `private/users/{userId}/attachments/{uuid}{ext}` (+ `-thumb.jpg`). A `chat/{conversationId}/{messageId}/...` layout is not possible: the object is uploaded before the message exists, so ownership is tracked in the `Media` document and access is decided through the message's room. Old objects keep their old keys and keep streaming through Node, so nothing existing breaks.

## 8. Environment variables

Render (backend): `CDN_BASE_URL` (the Worker URL, no trailing slash), `CDN_SIGNING_SECRET`, optional `CDN_PRIVATE_URL_TTL` (seconds, default 3600). Both of the first two must be set or the CDN is off and everything behaves as before. Existing `R2_*` unchanged. Worker: secret `CDN_SIGNING_SECRET`, var `ALLOWED_ORIGINS`.

## 9. Files

New: `backend/src/cdn.js`, `backend/src/storageKeys.js`, `backend/test/cdn.test.js`, `cdn-worker/` (`src/index.js`, `src/verify.js`, `wrangler.toml`, `package.json`, `test/verify.test.mjs`). Modified: `backend/src/storage.js`, `routes/media.js`, `routes/images.js`, `routes/upload.js`, `routes/upload-media.js`, `routes/upload-media-presign.js`, `routes/upload-media-complete.js`, `routes/info.js`, `routes/index.js`, `backend/.env.example`, `frontend/src/lib/useAuthorizedMediaUrl.js` (+ test), `DECISIONS.md`.

## 10. Testing plan

- Backend unit: signing is deterministic, every field is bound, expiry, public/private prefix enforcement, CDN off returns `null`.
- Backend routes: `/media/:id/url` allows room members and rejects outsiders (404) and unauthenticated callers; `/images` redirects only public-prefixed keys; presign produces `private/` keys; `complete` rejects an oversized object.
- Worker: node test that **backend-signed URLs verify in the Worker's code** (parity), tampering/expiry/prefix/traversal are rejected.
- Frontend: hook uses the signed URL, falls back to the blob path when CDN is off.
- Live (after you deploy the Worker): upload a file, fetch its signed URL, check `Range`, an expired URL, a tampered URL and a legacy key.
