# Call fixes log (Cloudflare Realtime)

What broke while getting calls working, what was tried, and what actually fixed it. Newest conclusions are at the bottom of each section. Related: `DECISIONS.md` D-049, `docs/CALL-QUALITY-METRICS.md`, `infra/cloudflare-realtime.md`.

## 1. Found only by testing against live Cloudflare

| # | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| 1 | `sessions/new` returned 400 | Cloudflare validates a `{}` body as a malformed `sessionDescription` | Send no body and no `Content-Type` on bodiless calls (`backend/src/calls/cloudflare/client.js`); the client test asserts it |
| 2 | Closing a track failed with "RTP extension ID reassignment not supported" | Renegotiating a close made Cloudflare's answer reassign a header-extension ID, which Chrome rejects | Close is now a forced close on the SFU (no SDP exchange) plus a local `transceiver.stop()` |
| 3 | Video quality very poor | Not the bitrate caps: WebRTC's slow bandwidth ramp-up held video at ~190-300 kbps | `x-google-start-bitrate` hint on the answer SDP, camera constrained to 720p/30, caps raised to 720p / 1.5 Mbps. Numbers in `docs/CALL-QUALITY-METRICS.md` (640x360 at 190 kbps became 1280x720 at ~660 kbps) |

## 2. Screen share and camera together

| # | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| 4 | Turning the camera off killed the screen share (and the reverse) | `stopVideo` / `stopScreen` both stopped `localStream`, which is the screen stream once sharing starts | Each stops only its own tracks; the local preview returns to the camera when the share stops (`frontend/src/lib/callManager.js`) |
| 5 | Remote side showed only the camera, never the screen | `Streams.jsx` kept one video per person, last one wins; the 1:1 fallback showed "the first video stream" | A shared screen is the main picture and the camera is a small tile (grid, spotlight and 1:1 views) |
| 6 | Top-bar thumbnails flipped between camera and screen | Same last-video-wins rule in `LittleStreams.jsx` | Same screen-first rule |
| 7 | Console error `Cannot read properties of null (reading 'getVideoTracks')` at join | Join tried to publish a camera that was never captured | Publish only the streams the join screen actually captured |

## 3. The hard one: a second person could not share their screen

**Symptom:** with two Chrome tabs, the first sharer's screen was visible, the second's never was. Console: `Failed to set remote answer sdp: Failed to set remote video description send parameters for m-section with mid='4'`, then every later publish or pull failed with `ERROR_CONTENT`.

Steps, in order:

1. **Per-section SDP edit.** My start-bitrate edit picked codec numbers from the whole SDP; Cloudflare numbers codecs differently per section, so it could touch the wrong codec (e.g. RTX). Fixed by resolving codecs per section and editing only the published mid, with a unit test. Real, but not the cause of this error.
2. **Retry ladder** (normal, then without the hint, then VP8 only). Did not work: after Chrome rejects an answer the connection is stuck in a sticky error, so a retry on the same connection cannot succeed. Removed again. The rollback and a `cloudflare answer rejected` console diagnostic stayed.
3. **Root cause and fix: separate connections for sending and receiving.** One connection that both published and subscribed made Cloudflare answer a new send section on a connection that already held receive sections, which Chrome rejected for good. Now each participant has two `RTCPeerConnection`s with two Cloudflare sessions:
   - Server: `cf:session:new` returns `sessionId` (send) and `pullSessionId` (receive). Push and close use the first; pull and renegotiate use the second.
   - Browser (`frontend/src/lib/cloudflareCall.js`): send connection and receive connection, each with its own serialized negotiation queue, so a pull never waits on a push.

**Confirmed working by hand** (two Chrome tabs, one sharing a WhatsApp window and one a Chrome tab).

## 4. Tooling: why headless tests missed it, and what they still cover

Headless Chromium never reproduced step 3, so the bug was only found from your console logs. The harness in `backend/loadtest/call-quality/` still verifies against real Cloudflare that nothing regressed:

- `second.cjs`: first person shares, second receives then shares, a third joins.
- `multi3.cjs`: 3-4 people each publishing audio, camera and screen concurrently (9 of 9 tracks flowing for 4 people).
- `screen.cjs`: a real `getDisplayMedia` capture.
- `quality.cjs`, `live-e2e.cjs`: bitrate and close/republish.

Unit tests: backend 69 (Cloudflare client, socket handlers, mediasoup), frontend 637 (26 for the call engine). The 7 `MeetingRecorder` failures are older and unrelated.

## 5. Other changes made along the way

- **Passkey error on localhost:** the passkey ID came from the first `CORS_ORIGIN` entry (`zephchat.tech`), which a browser on `localhost` rejects. Local fix: `VAULT_RP_ID=localhost` in `backend/.env`. On Render use `VAULT_RP_ID=zephchat.tech`.
- **Record-meeting button:** icon changed from a microphone to Sparkles (it looked like the mute button).
- **TURN not configured:** `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN` are empty, so calls between different networks may fail on strict NATs. Create a TURN key in the Cloudflare dashboard.

## 6. Found only on Render: calls timed out on `join`

**Symptom:** on the deployed site every call ended with "Could not connect to the call", console `Timed out waiting for a response to "join"`. Everything worked locally.

**Cause:** Render's log had `TypeError: util.isDate is not a function` at `nedb/lib/datastore.js`, logged as an uncaught exception. Render runs a newer Node than a laptop on Node 22, and Node 23 removed `util.isDate` and its siblings. `nedb` (the in-memory store for call producers and rooms) still calls them. The throw happens inside nedb's own callbacks, so no try/catch around the caller sees it and the `join` handler never answered.

**Fix:** `backend/src/compat/utilPolyfill.js` restores the missing `util.is*` helpers (and does nothing where they exist), loaded first in `backend/index.js`. `test/util-polyfill.test.js` deletes the helpers in a fresh process to prove nedb fails without the shim and works with it, on any Node version. Separately, the `join` handler now always answers (`join_failed`) and logs the real error.

**Lesson:** a local pass on one Node version says nothing about a host that floats to the latest. `NODE_VERSION=22` in Render's environment is a reasonable extra pin.

## 7. Every feature worked only once (found after the first successful real call)

**Symptom:** the call connected, but turning the mic, camera or screen share off and on again never worked a second time (screen share not at all).

**Cause:** Cloudflare tears down a session's transport when its last track is closed. Our "off" closes the track, so after it the send session is empty and dead: anything published on it afterwards never arrives. Subscribers' pulls then fail with `empty_track_error`, followed by `transport_unavailable_error`, and the pull code gave up on the first error. The first time worked because the connection was still starting, so there was a pause before the track was announced.

**How it was found:** a live toggle test (`backend/loadtest/call-quality/toggle.cjs`: off and on three times per feature while a second participant checks the bytes). Every cycle after the first failed. A control run that kept a second track published made every cycle pass, which proved the cause.

**Fix:**
- When publishing starts and nothing is currently published, the browser swaps in a fresh send connection and session (`cf:session:new { sendOnly: true }`); the receive side is untouched (`refreshSendConnection` in `cloudflareCall.js`; server support in `calls/cloudflare/index.js`).
- A track is announced to the room only once packets are actually leaving the browser (`waitSending`), not merely when the connection is up.
- A pull Cloudflare refuses because no media arrived yet is retried after 0.5, 1, 2, 4 and 8 seconds instead of being dropped.

**Result:** 9 of 9 off/on cycles deliver media (3 each for mic, camera, screen), and the earlier multi-person scenarios still pass. Unit tests cover the fresh send connection, keeping the connection while another track is published, and the pull retry.

## 8. Still open

- A call between two real devices over the internet through the deployed app.
- The deployed Render backend has none of this yet (nothing is committed); it also needs the `CF_*` variables and `VAULT_RP_ID`.
- Behaviour past the free 1,000 GB for an account with no card.
