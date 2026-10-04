# Call video quality: metrics and why we measure them

Measured against **live Cloudflare Realtime** on 2026-10-04. Harness: `backend/loadtest/call-quality/`.

## 1. Problem

Calls connected but the video looked poor. A connected peer connection says nothing about quality, so we needed numbers that show what is actually captured, sent and received.

## 2. Existing limitation

Two causes, found by measuring rather than guessing:

1. **Caps too low.** Video was limited to 360p / 600 kbps.
2. **Slow bandwidth ramp.** WebRTC starts at a low bitrate estimate and climbs slowly. Short calls and fresh joins sat at ~190-300 kbps no matter what the cap was.

## 3. Alternatives

| Option | Verdict |
| --- | --- |
| Raise caps only | Did not help alone (see matrix: 308 kbps, "limited by: bandwidth"). |
| Start-bitrate hint only | Did not help alone (old caps stay 193 kbps). |
| Simulcast | More complexity and more egress. Not needed for a 4-person cap. |
| Hint + 720p capture request + higher caps | **Chosen.** |

## 4. Decision

- `x-google-start-bitrate` (70% of max video bitrate) added to the **push answer SDP** for video and screen tracks.
- Camera track constrained to 720p / 30 fps via `applyConstraints` (UI asks for plain `{video:true}`, which yields 640x480).
- `contentHint`, sender `maxBitrate`, `scaleResolutionDownBy`, `maxFramerate` applied from server-provided limits.
- Defaults: 720p, 1.5 Mbps video, 2.5 Mbps screen, 48 kbps audio (`CALL_MAX_VIDEO_HEIGHT`, `CALL_MAX_VIDEO_KBPS`).

## 5. The metrics and why each one

All come from `RTCPeerConnection.getStats()` plus the track itself.

| Metric | Source | Why it is measured |
| --- | --- | --- |
| Captured resolution | track settings | Shows what the **app really captures**. The UI requests `{video:true}` so this was 640x480, which capped everything downstream. Without it we would blame the encoder for a capture problem. |
| Sent resolution / fps | `outbound-rtp` `frameWidth`, `frameHeight`, `framesPerSecond` | What the sender actually encodes, as opposed to what the caps allow. |
| Sent bitrate | `outbound-rtp` `bytesSent` delta over a 5 s window, after an 8 s ramp | Bitrate is the best single proxy for visual quality. The ramp delay is deliberate: it avoids reporting the slow start as steady state. |
| `qualityLimitationReason` | `outbound-rtp` | Says **why** the encoder reduced quality (`none`, `bandwidth`, `cpu`). This is what exposed the bandwidth-estimate ramp. |
| Subscriber receives | `inbound-rtp` same fields | Proves the SFU does not degrade the stream: received must equal sent. |
| `track.muted === false` | received track | Proves media is flowing, not just that ICE/DTLS connected. |

## 6. Measured result

Conditions: fake camera, headless Chromium, real Cloudflare, one local machine and network. UI-style capture 640x480. 8 s ramp, 5 s measure window.

### Caps vs start-bitrate hint (steady-state sent)

| | No hint | With hint |
| --- | --- | --- |
| **Old caps** (360p / 600 kbps) | 640x360 @20 fps, 193 kbps | 640x360, 193 kbps |
| **New caps** (720p / 1.5 Mbps) | 640x360 @20 fps, 308 kbps, limited by: bandwidth | **1280x720 @20 fps, 639 kbps** |

Neither change works alone. The hint lets the estimator ramp, and the higher caps give it room to.

### Repeat samples (final code, old vs new caps)

| Sample | Old caps sent | New caps sent | Subscriber receives (new) |
| --- | --- | --- | --- |
| 1 | 640x360 @19 fps, 190 kbps | 1280x720 @20 fps, 664 kbps | 1280x720 @20 fps, 664 kbps |
| 2 | 640x360 @20 fps, 191 kbps | 1280x720 @19 fps, 637 kbps | 1280x720 @20 fps, 638 kbps |

Result: **~3.4x the bitrate, 4x the pixels**, `qualityLimitationReason: none`, and the subscriber receives exactly what was sent.

### Live end-to-end

Session create, publish, subscribe with media flowing (`muted === false`), close, republish: all passed against real Cloudflare.

## 7. Cost implication (egress)

Cloudflare's free tier is 1,000 GB/month egress.

- At the 1.5 Mbps cap: 0.675 GB/hour per received stream.
- Measured ~0.65 Mbps: ~0.29 GB/hour per received stream.
- 4 people means ~3 received streams each, about 2 GB per participant-hour at the cap.
- Usage guard default of 25,000 participant-minutes (~417 h) is ~830 GB worst case, inside the allowance.

## 8. Tests

- Backend: 11 client tests (`cloudflare-call-client.test.js`) and 32 socket tests (`cloudflare-call-socket.test.js`: auth, isolation, validation), plus 26 existing mediasoup tests still passing.
- Backend full run: 135 of 138 suites pass. Failures are pre-existing and unrelated: `add-people` (flaky under load), `aiMeetingEligibility` (DB timeouts), `aiQueueJobId`.
- Frontend: 23 engine tests (`cloudflareCall.test.js`, fake RTCPeerConnection). 632 pass overall; 7 pre-existing `MeetingRecorder` label failures.

## 9. Caveats (read before quoting these numbers)

- The fake camera produces synthetic, low-complexity video. Real faces and motion need more bitrate, so real numbers will be higher, up to the cap.
- One machine, one network. Real quality depends on each user's upload speed.
- The "old caps" row runs the **new engine code** with the old limits, so it isolates the caps, not the whole old implementation.
- Not verified: a two-real-device call through the full app, the deployed Render backend, TURN (key not set), and behaviour past the free 1,000 GB.

## 10. Reproduce

See `backend/loadtest/call-quality/README.md`.
