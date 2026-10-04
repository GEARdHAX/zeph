// In-page glue: stubs for reactn/redux. window.__makeIO (a fake in-page SFU) is only for quick
// offline experiments; the live scripts in this folder replace the socket with real Cloudflare calls.
import * as engine from './engine.js';

window.__g = { streams: [] };
window.__redux = { io: { io: null }, rtc: { producers: [] } };
window.__engine = engine;

// Capture every RTCPeerConnection the engine creates and give the fake SFU a way to reach it.
const RealPC = window.RTCPeerConnection;
window.__clientPCs = [];
window.RTCPeerConnection = class extends RealPC {
  constructor(...a) { super(...a); window.__clientPCs.push(this); }
};

const waitGathered = (pc) => new Promise((res) => {
  if (pc.iceGatheringState === 'complete') return res();
  pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && res());
});

// ---- fake Cloudflare: a second PeerConnection that behaves like an ICE-lite SFU ----
let sfu = null; let n = 0; const sent = [];
window.__sfuEvents = [];
window.__failPushOnce = false;
window.__sfuTracks = [];      // tracks the fake SFU received
window.__makeIO = (mic) => ({
  id: 'me',
  request: async (event, payload) => {
    window.__sfuEvents.push(event);
    if (event === 'cf:session:new') {
      sfu = new RealPC();
      sfu.ontrack = (e) => window.__sfuTracks.push({ kind: e.track.kind, mid: e.transceiver.mid });
      const client = window.__clientPCs[window.__clientPCs.length - 1];
      return { sessionId: `sess-${++n}` };
    }
    if (event === 'cf:tracks:push') {
      if (window.__failPushOnce) { window.__failPushOnce = false; throw new Error('too_many_tracks'); }
      const client = window.__clientPCs[window.__clientPCs.length - 1];
      client.onicecandidate = (e) => e.candidate && sfu.addIceCandidate(e.candidate).catch(() => {});
      sfu.onicecandidate = (e) => e.candidate && client.addIceCandidate(e.candidate).catch(() => {});
      await sfu.setRemoteDescription({ type: 'offer', sdp: payload.sessionDescription });
      const answer = await sfu.createAnswer();
      await sfu.setLocalDescription(answer);
      await waitGathered(sfu);
      return { sessionDescription: sfu.localDescription.sdp, producerIDs: payload.tracks.map((t) => `sess-${n}/${t.trackName}`), rejected: [] };
    }
    if (event === 'cf:tracks:ready') return { announced: payload.producerIDs.length };
    if (event === 'cf:tracks:pull') {
      const t = sfu.addTransceiver(mic.getAudioTracks()[0].clone(), { direction: 'sendonly' });
      const offer = await sfu.createOffer();
      await sfu.setLocalDescription(offer);
      sent.push(t);
      return { sessionDescription: sfu.localDescription.sdp, requiresImmediateRenegotiation: true,
        tracks: payload.producerIDs.map((producerID) => ({ mid: t.mid, producerID, socketID: 'peer-socket', kind: 'audio' })) };
    }
    if (event === 'cf:renegotiate') { await sfu.setRemoteDescription({ type: 'answer', sdp: payload.sessionDescription }); return { ok: true }; }
    if (event === 'cf:tracks:close') {
      await sfu.setRemoteDescription({ type: 'offer', sdp: payload.sessionDescription });
      const answer = await sfu.createAnswer();
      await sfu.setLocalDescription(answer);
      return { sessionDescription: sfu.localDescription.sdp };
    }
    throw new Error('unexpected ' + event);
  },
});
