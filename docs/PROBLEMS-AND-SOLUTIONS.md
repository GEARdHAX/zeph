# What was built, the problems hit, and how each was solved

Calling, the meeting UI, R2 storage and the CDN, October 2026. Each entry is: **problem, cause, how it was found, fix**. Deeper write-ups live in `DECISIONS.md` (D-049 calls, D-050 CDN), `docs/CALL-FIXES-LOG.md`, `docs/CALL-QUALITY-METRICS.md` and `docs/CDN-ARCHITECTURE.md`.

## What now exists

- **Calls** on Cloudflare Realtime (free SFU), selected with `CALL_BACKEND=cloudflare|mediasoup`. mediasoup is kept as the self-hosted option.
- **Meeting UI**: Google-Meet-style grid, a name on every tile, a shared screen that takes the stage, a phone-friendly control bar.
- **R2 storage** for uploads, kept private.
- **CDN**: a Cloudflare Worker (`cdn-worker/`) that serves files from the private bucket through signed links. The backend keeps authentication and authorization.
- **Avatar replacement**: changing a picture deletes the old one.

## Part 1: Calls

| Problem | Cause | How it was found | Fix |
| --- | --- | --- | --- |
| No host could run mediasoup for free | mediasoup needs a raw UDP/TCP port range; Render exposes one port | Reading the hosting limits (D-048) | Cloudflare Realtime SFU: plain HTTPS from the backend, free 1,000 GB/month, no card to start |
| Meeting logic was tangled with mediasoup | One file owned both authorization/lifecycle and the media plane, and loaded the native module at import | Reading the code before changing it | Extracted `calls/roomLifecycle.js` (shared), then added a Cloudflare backend beside mediasoup. A refactor bug (a variable left behind) surfaced as join tests timing out and was fixed |
| Cloudflare returned 400 creating a session | It treats `{}` as a malformed session description | First run against live Cloudflare | Send no body and no `Content-Type` when there is nothing to send |
| Closing a track broke the connection | Renegotiating a close made Chrome reject an RTP header-extension change | Live test | Close tracks with a forced close (no negotiation) and stop the transceiver locally |
| Video quality was very poor | Not the bitrate cap: WebRTC's bandwidth estimate starts low and ramps slowly | Measured with `getStats()` against live Cloudflare: 640x360 at ~190 kbps | A start-bitrate hint, camera asked for 720p/30, caps raised. Result 1280x720 at ~660 kbps (`docs/CALL-QUALITY-METRICS.md`) |

## Part 2: Camera and screen share

| Problem | Cause | Fix |
| --- | --- | --- |
| Turning the camera off killed the screen share | Both stop functions stopped `localStream`, which becomes the screen stream while sharing | Each now stops only its own tracks; the preview returns to the camera when the share stops |
| The other side saw only the camera | The UI kept one video per person (last wins); the 1:1 view showed "the first video" | Split camera and screen by the producer's `isScreen` flag; the screen gets its own tile |
| A second person could not share while receiving a share | One connection both sent and received. Cloudflare's answer for a new send section clashed with the receive sections, Chrome rejected it, and the connection stayed broken | Two connections per person (send-only and receive-only) with two Cloudflare sessions. First two attempts (scoping my SDP edit, retrying) did not work; the browser console's `cloudflare answer rejected` log pointed to the real cause |

The headless test browser never reproduced that last one, so it was found from the real console output. The test harness (`backend/loadtest/call-quality/`) still guards against regressions with real Cloudflare: 4 people each publishing audio, camera and screen at once.

## Part 2b: Features worked only once

| Problem | Cause | Fix |
| --- | --- | --- |
| After the call connected, mic, camera and screen share worked once; turning them off and on again never worked (screen share not at all) | Cloudflare drops a session's transport when its last track is closed, so tracks published later on that same session are never received. Subscribers got `empty_track_error` then `transport_unavailable_error`, and the pull code gave up | A fresh send connection and session when publishing restarts from empty; a track is announced only after packets are really leaving; refused pulls are retried with backoff. Found by a live off/on test, confirmed by a control run that kept a second track alive |
| The same happened on the receiving side (`410 Session appears to be disconnected`), and a failed close left the button stuck "on" | A receive session with nothing live is also dropped by Cloudflare; the stop handlers exited before resetting their state when the server call failed | Fresh receive connection when nothing live is being received; the server removes a track even if Cloudflare rejects the close; stop handlers always reset the button; one automatic retry of a refused publish; the console names the failing request |

## Part 2c: The delay after turning a feature back on

About 1-2 s on a real network: a new Cloudflare session, the connection handshake, then the other side pulls and renegotiates. Measured at about 0.7 s (sender) plus 0.6 s (receiver) without the server round trips. Reduced by creating the next send and receive sessions in the background as soon as the previous ones go idle, faster first-packet detection, parallel camera tuning and an earlier first retry; the rest is real network time, so the meeting now shows it: control buttons spin and ignore extra clicks while a change is in flight, and remote tiles show "Starting X's camera..." / "Loading X's screen..." until the media arrives (giving up after 15 s).

## Part 3: Meeting UI

- **Names**: a tag on every tile; a presenter's screen is labelled "Name's screen"; your own preview says "You".
- **Grid**: 1 fills the stage, 2 side by side (stacked on a phone), 3-4 make 2x2, then wider; incomplete rows are centered. A shared screen takes the stage and everyone else sits in a strip; any tile can be pinned.
- **Phones**: camera, mic, share, record and Leave always fit; Add people, Share and layout move into a "More" menu; the share-screen button is hidden where the browser can't capture a screen; safe-area padding for the home bar.
- The old top thumbnail bar duplicated the strip and was removed.

## Part 4: Storage and the CDN

| Problem | Cause | Fix |
| --- | --- | --- |
| Every download streamed through Render | `media.js`, `images.js`, `files.js` piped bytes through Node: no cache headers, no Range, so video could not seek | Worker in front of the private bucket. Public files (avatars) redirect to an immutable-cacheable signed link. Chat media gets a short-lived signed link after the existing login and room-membership check |
| Making the bucket public would have been simplest | It would drop authorization on private chat media | Kept the bucket private; the Worker reads it through a binding, so no R2 credential is shared. `public/` and `private/` key prefixes, enforced by both the backend and the Worker |
| Direct uploads trusted the size the client declared | `complete` never checked the real object | `complete` now reads the object's real size and rejects one over the category limit |
| Direct uploads were served as `application/octet-stream` | No MIME type was stored | Exact type derived from the validated extension |
| **Tests would have written into the real bucket** | Jest inherited the real R2 settings from `backend/.env` | `test/helpers/env.js` blanks R2 and CDN variables before every test |
| Wrangler created a stray empty bucket | My config named `chitcx-uploads` (from the brief); the real bucket is `zeph-uploads` | Bound the Worker to the real bucket; the empty one is left to delete by hand |
| Old avatars piled up | Nothing deleted them | A change deletes the old image and its resized copies. A new picture gets a new key rather than overwriting, because public URLs are cached for a year. The old image is kept if it isn't the user's, a chat message shows it, or a group or another user uses it |

## Part 5: Bugs that only appeared on Render

| Problem | Cause | How it was found | Fix |
| --- | --- | --- | --- |
| "Could not connect to the call" | Console said `Timed out waiting for a response to "join"` | Console error, plus a `callBackend` field added to `/api/info` to confirm the server's engine | `join` handler now always answers (`join_failed`) and logs the real error |
| The `join` still hung | Render log: `util.isDate is not a function` in `nedb`. Render runs a newer Node than a laptop on Node 22; Node 23 removed those helpers; `nedb` throws inside its own callbacks where no try/catch can see it | Reading Render's server log line | `backend/src/compat/utilPolyfill.js` restores the missing helpers, loaded first in `index.js`. Tested in a fresh process with the helpers deleted, so it proves the behaviour on any Node version |
| Passkey errors locally | The passkey ID came from the first `CORS_ORIGIN` entry (`zephchat.tech`), which a `localhost` page can't use | Reading config against the env | `VAULT_RP_ID=localhost` locally, `zephchat.tech` on Render |

## Part 6: Icons and link previews

| Problem | Cause | Fix |
| --- | --- | --- |
| Google showed a generic globe instead of the zeph icon | Every icon file was distorted and mislabelled (`favicon-32` was 87x90, `logo192` 137x138, `logo512` 150x140, `favicon.ico` a 16 px file from 2019), and only 16/32 px favicons were declared. Google needs a square icon, a multiple of 48 px, at a crawlable URL | Redrew the mark as one vector and generated a correct set from it with `frontend/scripts/build-brand-assets.cjs`: `favicon.svg`, 16/32/48/96 px PNGs, a multi-size `favicon.ico`, 180 px apple-touch icon, 192/512 px logos and a maskable 512 px. The head declares 48 and 96 px; the manifest sizes are now true (Chrome had also warned about `logo192.png`) |
| The link preview thumbnail cut the wordmark to "ph." | The 1200x630 card had everything on the left, and chat apps centre-crop it to a square | New card with a centred lockup (mark, wordmark, tagline) that reads whole as both a wide card and a square crop, saved as `og-zeph-v2.png` so crawlers and chat apps fetch it instead of reusing the cached old one |

Google refreshes favicons on its own schedule (days to weeks); requesting indexing of the home page in Search Console speeds it up.

## Part 7: Blank avatar after signing back in

| Problem | Cause | Fix |
| --- | --- | --- |
| Sign out on the phone, change the picture on the PC, sign in on the phone: blank avatar | Two things. (1) A browser kept the old picture reference in its stored profile after the picture changed elsewhere, and the old image is now deleted. (2) The **passkey** login loaded the user without populating the picture, so the session token carried a bare ID with no `shieldedID`, and the app requested `/api/images/undefined/...`. Password login already populated it | (1) the change is pushed to the user's other sessions, and the startup check returns the current picture so a stale browser corrects itself (see Part 2c area). (2) `passkey/login-verify.js` now populates the picture; `passkey-login-picture.test.js` fails without that line. A picture that still fails to load falls back to the initials |

## What worked as a method

1. **Measure before tuning.** The video-quality fix came from `getStats()` numbers, not guesses.
2. **Test against the real service early.** The first live run found two Cloudflare behaviours no mock could.
3. **Make failures loud.** The silent 15-second timeout hid the real error twice; logging the real error and always answering was worth more than any guess.
4. **Real consoles beat simulators.** The send/receive clash and the Render Node bug were both invisible locally and obvious in the real console and log.
5. **Keep the old path as the fallback.** The CDN, the call engine and the avatar change all fall back to the previous behaviour when switched off or when something is missing.

## Still open

- A call between two real devices on different networks needs a TURN key (`CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`); Render's log showed `"turn": false`.
- Edge caching of public files needs `zephchat.tech` on Cloudflare DNS (the Cache API doesn't work on `workers.dev`).
- The empty `chitcx-uploads` bucket should be deleted in the Cloudflare dashboard.
- `NODE_VERSION=22` on Render is a sensible extra pin.
