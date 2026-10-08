# Calls Architecture

## 12. Video and audio calls

```mermaid
flowchart TB
  subgraph Choice["Runtime choice: CALL_BACKEND"]
    CF["cloudflare — Cloudflare Realtime SFU<br/>default, used in production"]
    MS["mediasoup — self-hosted SFU<br/>alternative, needs open UDP port range<br/>not reachable on the current host"]
  end

  P1["Participant 1"]
  P2["Participant 2"]
  P3["Participant N"]

  Life["Zeph call lifecycle<br/>join and leave events,<br/>authorization, history"]
  Guard["Usage guard<br/>monthly participant-minutes"]
  SFU["Cloudflare Realtime SFU"]

  P1 & P2 & P3 -- "Socket.IO signalling" --> Life
  Life --> Guard
  Guard -- "allowed" --> SFU
  Guard -- "monthly limit reached" --> Refuse["Call refused"]
  P1 & P2 & P3 <-- "WebRTC media tracks" --> SFU
  Life --- Choice
```

### Sessions per participant

```mermaid
sequenceDiagram
  autonumber
  participant P as Participant browser
  participant Z as Zeph backend
  participant SFU as Cloudflare Realtime

  P->>Z: join call (authenticated)
  Z->>Z: authorize: caller, callee or group member
  Z->>Z: usage guard allows?
  Z-->>P: call config (limits, ICE servers)
  P->>Z: create send session
  Z->>SFU: new session
  P->>Z: create receive session
  Z->>SFU: new session
  P->>SFU: publish camera / mic / screen tracks (send session)
  Z-->>P: announce new tracks from others
  P->>Z: pull those tracks
  Z->>SFU: subscribe on the receive session
  SFU-->>P: remote media (receive session)
  Note over P,SFU: toggling a track off then on starts a fresh session
```

| Aspect | Detail |
|---|---|
| Separate send and receive sessions | Publishing and subscribing use different sessions, which fixed video and screen share not reaching other participants |
| Quality caps | Video capped by resolution and bitrate; participant count capped |
| Usage guard | Participant-minutes tracked monthly in Redis; calls are refused past the limit, which bounds cost |
| Authorization | Joining re-runs the same conversation/meeting authorization as other endpoints |
| History | Call sessions and timeline events are recorded |

Measured (live Cloudflare, synthetic camera, one machine): delivered video went from 640x360 at about 190 kbps to 1280x720 at about 640-660 kbps; 9 of 9 camera/mic/screen off-on cycles delivered. See [`../CALL-QUALITY-METRICS.md`](../CALL-QUALITY-METRICS.md). A test across two real devices is still pending.

**Why this design?** An SFU forwards each participant's media instead of mixing or meshing it, which keeps client bandwidth reasonable as participants join. The host running the API cannot expose the wide UDP range a self-hosted SFU needs, so the managed SFU is the production path and mediasoup stays available behind the same signalling layer.
