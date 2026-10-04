# New features: what was added, how it works, where it lives

A feature-by-feature analysis of everything added in the calling, meeting-UI, storage/CDN and polish work (19 commits after the marketing-site milestone `164c7d7`, roughly 100 files). Written for the project owner and for anyone reviewing the codebase.

Related documents: `DECISIONS.md` (D-049 calls, D-050 CDN), `docs/CALL-FIXES-LOG.md` (call bugs in order), `docs/PROBLEMS-AND-SOLUTIONS.md` (problem, cause, fix), `docs/CALL-QUALITY-METRICS.md` (video-quality numbers), `docs/CDN-ARCHITECTURE.md` (CDN design and setup).

## 1. At a glance

| # | Feature | What a user or operator gets | Main code |
| --- | --- | --- | --- |
| 1 | Cloudflare Realtime calling | Working audio/video/screen-share calls that run on a free host, with mediasoup kept as an option | `backend/src/calls/`, `frontend/src/lib/cloudflareCall.js`, `callManager.js` |
| 2 | Resilient media controls | Mic, camera and screen share can be turned off and on repeatedly without getting stuck | `cloudflareCall.js`, `calls/cloudflare/index.js` |
| 3 | Meet-style meeting UI | Names on every tile, tiled grid, presenter on stage, pinning, loading states | `frontend/src/features/Meeting/` |
| 4 | Phone-friendly controls | Call control bar, chat bar and image viewer that fit a phone | `Meeting/index.jsx`, `BottomBar.jsx`, `MediaViewerShell.jsx` |
| 5 | Private R2 storage with direct uploads | Files go straight from the browser to R2; the bucket stays private | `storage.js`, `upload-media-*.js`, `cdn-worker/r2-cors.json` |
| 6 | Signed-URL CDN (Cloudflare Worker) | Fast, range-capable file delivery without exposing the bucket | `cdn-worker/`, `backend/src/cdn.js`, `storageKeys.js` |
| 7 | Profile picture lifecycle | Replacing a picture deletes the old one; every session stays in sync; failures fall back to initials | `retireImage.js`, `change-picture.js`, `init.js`, `initIO.jsx` |
| 8 | Brand assets and link previews | Correct square icons for Google and browsers; a link-preview card that survives cropping | `frontend/scripts/build-brand-assets.cjs`, `public/` |
| 9 | Operability | Health-check scripts, call-engine reporting, readable failure logs, a live test harness | `backend/scripts/`, `/api/info`, `backend/loadtest/call-quality/` |
| 10 | Platform hardening | Works on Node 23+ hosts; tests can no longer touch real storage | `compat/utilPolyfill.js`, `test/helpers/env.js` |

## 2. Calling on Cloudflare Realtime

**Why:** mediasoup needs a raw UDP/TCP port range that PaaS hosts such as Render cannot expose, and a VM was not available. Cloudflare Realtime is a hosted SFU driven over plain HTTPS, so it runs anywhere and the free allowance (1,000 GB of egress a month) is enough for a portfolio project.

**Design**
- `CALL_BACKEND=cloudflare|mediasoup` selects the engine (default `cloudflare`). mediasoup is untouched and still needs `MEDIASOUP_ENABLED=true`.
- Meeting lifecycle (authorization, join/leave, presence, call history) was extracted into `calls/roomLifecycle.js` and is shared by both engines through hooks (`beforeJoin`, `afterLeave`, `onMediaCleanup`). The Redux store, the socket events `newProducer`/`remove`, and the Meeting UI are identical for both engines, because every Cloudflare track is exposed as a "producer".
- Each participant has **two WebRTC connections and two Cloudflare sessions**: one only sends, one only receives. A single connection that did both made Chrome reject Cloudflare's answers once someone was receiving while starting to share.
- The browser never sees Cloudflare credentials. It asks the server, which calls Cloudflare.

**Socket events** (all acknowledged; failures reply `{ error: '<code>' }`): `call:config`, `cf:session:new` (`renew`, `sendOnly`, `pullOnly`), `cf:tracks:push`, `cf:tracks:ready`, `cf:tracks:pull`, `cf:renegotiate`, `cf:tracks:close`.

**Security**
- Every call event re-runs `authorizeMeetingJoin` against the server's own record of the socket's room. Clients never name a Cloudflare session or another meeting.
- Pulls resolve from the server's registry, scoped to the caller's meeting. A foreign or non-existent track is refused.
- Only the owner can close a track. Cloudflare's error text never reaches the client (`call_request_failed`).
- A track is announced to the room only after the publisher confirms its media is flowing, so nobody pulls a dead track.

**Limits and cost guard:** 4 participants (`CALL_MAX_PARTICIPANTS`), 720p / 1.5 Mbps video, 2.5 Mbps screen, 48 kbps audio. A lightweight monthly guard counts participant-minutes in Redis (`CF_MONTHLY_PARTICIPANT_MINUTES`, default 25,000, about 830 GB worst case), blocks only new joins, and fails open.

**Video quality:** measured against live Cloudflare, 640x360 at about 190 kbps became 1280x720 at about 660 kbps (`docs/CALL-QUALITY-METRICS.md`). The cause was WebRTC's slow bandwidth ramp-up, not the caps: a start-bitrate hint (scoped to the published SDP section), a 720p/30 capture request and higher caps fixed it.

## 3. Resilient media controls

Cloudflare disconnects a session that has nothing live on it, on either side. The engine handles that:
- **Fresh send session** when publishing restarts from empty (`cf:session:new { sendOnly }`); **fresh receive session** when pulling resumes from empty (`{ pullOnly }`). The next session is created in the background as soon as the previous one goes idle, so re-enabling only has to connect.
- A track is announced only once packets are really leaving the browser (40 ms polling).
- A pull Cloudflare refuses because media has not arrived (`empty_track_error`) is retried at 0.25, 0.5, 1, 2, 4 and 8 s.
- A refused publish is retried once on a brand-new send connection.
- A failed Cloudflare close no longer strands a track in the room, and the mic/camera/screen stop handlers always reset their button state.
- The `join` handler always answers (`join_failed`) and logs the real error; the browser console names the failing request (`call request failed: <event> <code>`).

Verified live: 9 of 9 off/on cycles (mic, camera, screen, three each) deliver media, and 3 to 4 people publishing audio, camera and screen at once all receive everything.

## 4. Meet-style meeting UI

- **Name on every tile**; a presenter's screen is a separate tile labelled "Name's screen"; your own preview is "You".
- **Tiled grid:** 1 person fills the stage, 2 side by side (stacked on a phone), 3 to 4 form 2x2, then 3 and 4 columns; a short last row is centred.
- **Stage and strip:** a shared screen takes the large area and everyone else sits in a strip (a column on wide screens, a row on phones). Any tile can be pinned and unpinned. The spotlight layout is kept.
- **Loading states:** the mic, camera and screen buttons show a spinner and ignore extra clicks while a change is in flight (`callManager.withPending`). A remote tile shows "Starting X's camera..." and a presenter's tile shows "Loading X's screen..." until the media arrives, giving up after 15 s.
- **Camera and screen together:** stopping one no longer stops the other.

## 5. Phone-friendly controls

- **Call bar:** camera, mic, share screen, AI record, then a ⋯ menu (Add people, Share meeting, layout) and a red Leave button. Safe-area padding for the iPhone home bar.
- **Screen share on phones is unavailable:** phone browsers do not provide the Screen Capture API, so the button is hidden there rather than failing. Phones can still view shared screens.
- **Chat bar:** below tablet width, emoji, photo and file sit behind one ⋯ button; the AI buttons and Send stay visible.
- **Image viewer:** zoom, rotate and reset float in a pill at the bottom on phones; Close, filename and Download stay in the top bar; the dialog uses dynamic viewport height.
- **Emoji picker:** the skin-tone selector was removed (`skinTonePosition="none"`).

## 6. Private R2 storage and direct uploads

- Uploads use `storage.js` (R2 when configured, local-disk fallback otherwise). Chat attachments go **browser to R2 directly** with a presigned link; the server then validates the object (content sniff, archive check, thumbnail) before it becomes `READY`.
- **New hardening:** `complete` reads the real object size and rejects one over the category limit (the declared size was never verified), and stores an exact `mimeType` (direct uploads were served as `application/octet-stream`). `storage.js` gained `getObjectMetadata` and `objectExists`.
- **Bucket CORS is required** for browser uploads: `cdn-worker/r2-cors.json` allows `PUT` only, only from the site's origins. Without it the browser blocks the upload before it starts. Apply with `wrangler r2 bucket cors set zeph-uploads --file r2-cors.json`.
- **Key scheme** (`storageKeys.js`): `public/users/{id}/avatar/{shieldedId}.jpg` (+ sized copies) and `private/users/{id}/attachments/{uuid}{ext}` (+ `-thumb.jpg`). The first segment is the visibility; the original filename is never in a key. Older objects keep their old keys.

## 7. Signed-URL CDN

A Cloudflare Worker (`zeph`, in `cdn-worker/`) serves the private bucket through an R2 *binding*, so no R2 credential leaves the backend.
- URL shape: `/o/<public|private>/<key>?exp=&sig=[&d=&n=&ct=]`, signed with HMAC-SHA256 over version, key, expiry, disposition, filename and content type (so none can be edited). Constant-time check; strict key allow-list; only `public/` and `private/` prefixes are served.
- **Public** files (avatars): deterministic signature, `Cache-Control: public, max-age=31536000, immutable`, CORS `*`. `/api/images/:id/:size` answers 302 to the edge, so no frontend change was needed.
- **Private** files (chat media): `GET /api/media/:id/url` runs the existing login and room-membership check, then returns a signed link valid for 1 hour (`CDN_PRIVATE_URL_TTL`), served with `private, max-age=300`, never in a shared cache. Range requests work, so video seeking works.
- **Fallbacks:** with the CDN off, or for an older object, everything streams through the backend as before. The frontend hook asks for a signed link first and falls back to the authenticated blob path.
- **Honest limit:** edge caching of public files needs the domain on a Cloudflare zone (the Cache API does nothing on `*.workers.dev`); until then browsers cache them via the immutable header.

## 8. Profile picture lifecycle

- **Replace, not accumulate:** changing or removing a picture deletes the old image, its sized copies and its record (`retireImage.js`). A new picture still gets a new key, because public URLs are cached for a year. The old one is kept if it is not the user's, a chat message shows it, or a group or another user uses it.
- **Sync across sessions:** the change is pushed to the user's other sessions (`user-profile-updated`), and `/api/check-user` returns the current picture so a stale browser corrects its stored profile at the next load.
- **Fallback:** a picture that fails to load shows the initials (sidebar avatar and welcome screen).
- **Passkey login fix:** the passkey login now populates the picture, as password login does; before, the avatar requested `/api/images/undefined/...`.

## 9. Brand assets and link previews

`frontend/scripts/build-brand-assets.cjs` regenerates every icon from one vector mark: `favicon.svg`, 16/32/48/96 px PNGs, a multi-size `favicon.ico`, the Apple icon, 192/512 px and maskable logos, and `og-zeph-v2.png`. The old files were distorted and mislabelled (so Google showed a generic globe). The head declares the 48 and 96 px sizes Google needs, the manifest sizes are true, and the 1200x630 preview centres its content so it survives the square crop chat apps use.

## 10. Operability and tooling

| Tool | Purpose |
| --- | --- |
| `npm run calls:check` | Verifies the Cloudflare Realtime credentials (never prints them) |
| `npm run r2:check` | Create, read, update and delete round trip against R2 |
| `npm run cdn:check` | Live check of the deployed Worker: loads, Range, tampered/expired/unsigned links |
| `GET /api/info` | Reports `directUploadEnabled`, `cdnEnabled` and `callBackend` (`null` means calls are off) |
| `backend/loadtest/call-quality/` | Live harness against real Cloudflare: quality, multi-person, screen, off/on cycles |

## 11. Platform hardening

- `compat/utilPolyfill.js` restores the `util.is*` helpers Node 23 removed. `nedb` (call and room state) calls them, and on Render the join hung until the browser timed out. Tested by deleting the helpers in a fresh process.
- `test/helpers/env.js` blanks R2 and CDN settings before every test, so a developer's real credentials in `.env` can no longer make the suite write into the real bucket.

## 12. Configuration reference

| Variable | Where | Purpose |
| --- | --- | --- |
| `CALL_BACKEND` | Render | `cloudflare` (default) or `mediasoup`; leave unset or `cloudflare`, anything else disables calls |
| `CF_REALTIME_APP_ID`, `CF_REALTIME_APP_SECRET` | Render | Cloudflare Realtime SFU credentials |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | Render | TURN, for calls across strict networks (not set yet) |
| `CALL_MAX_PARTICIPANTS`, `CALL_MAX_VIDEO_HEIGHT`, `CALL_MAX_VIDEO_KBPS`, `CF_MONTHLY_PARTICIPANT_MINUTES` | Render | Optional tuning of the call limits |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Render | Object storage (all four, or uploads stay on local disk) |
| `CDN_BASE_URL`, `CDN_SIGNING_SECRET`, `CDN_PRIVATE_URL_TTL` | Render | Worker URL, shared signing secret, private link lifetime |
| `CDN_SIGNING_SECRET` (Wrangler secret), `ALLOWED_ORIGINS` (var) | Worker | Same secret as Render; origins allowed to `fetch()` private files |
| `VAULT_RP_ID` | Render `zephchat.tech`; local `localhost` | Passkey relying-party ID; must match the site's host |

## 13. Verification summary

| Area | Result |
| --- | --- |
| Frontend (Vitest) | 673 pass; 7 fail, all in `MeetingRecorder.test.jsx` (label wording, failing before this work) |
| Cloudflare Worker (`node --test`) | 12 of 12, including a check that backend-signed links verify in the Worker |
| Backend, the relevant 14 suites | 131 of 131 (calls, CDN, uploads, pictures, passkeys, info) |
| Live against Cloudflare | 9 of 9 off/on cycles; 4 people publishing 3 tracks each, all received; deployed Worker passes all 9 `cdn:check` items; full upload pipeline verified against the real bucket |

## 14. Known limits and open items

- **TURN:** it was not configured at the last check (the server log showed `turn: false`). Without it, calls between two strict networks (for example a phone on mobile data) may fail; set `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN` to fix that.
- **Edge caching** of public files needs `zephchat.tech` on Cloudflare DNS (see section 7).
- **Phone screen sharing** is not possible in a browser (section 5).
- **Older images:** 13 older image records (3 whose objects are gone from R2, 10 from the local-disk days) return 404; no user currently uses one as a picture.
- **Free-tier realities:** 4-person calls, Render's free instance cold-starts, and Cloudflare's 1,000 GB/month egress allowance.
- **Verified by hand on the deployed app:** a call with mic, camera and screen share between two browsers, including turning each off and on. **Not verified:** calls between two strict networks with TURN, and the phone layouts on a real phone. The guided product tour's emoji and attachment steps point at desktop buttons that are hidden on phones.
- A stray empty bucket `chitcx-uploads` (created by a mistaken first deploy) should be deleted in the Cloudflare dashboard, if it has not been already.
