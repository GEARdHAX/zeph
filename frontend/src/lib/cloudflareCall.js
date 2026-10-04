import { getGlobal, setGlobal } from 'reactn';
import store from '../store';

// Browser half of the Cloudflare Realtime call backend (CALL_BACKEND=cloudflare).
// Two RTCPeerConnections, each with its own Cloudflare session: one only SENDS our
// camera/mic/screen ("push"), the other only RECEIVES other participants' tracks
// ("pull"). Mixing both directions on one connection made Cloudflare's answers
// clash with the receive sections and Chrome rejected them for good. The server
// (backend/src/calls/cloudflare) authorizes each step and talks to Cloudflare's
// HTTPS API; the browser never sees Cloudflare credentials.
//
// callManager.js owns the call lifecycle and the Redux/global state; this module
// only owns the connection. Remote tracks surface as MediaStreams carrying the
// same fields the mediasoup path sets (producerID, socketID, userID, isVideo), so
// the Meeting UI is identical for both backends.

const getIO = () => store.getState().io.io;

const fresh = () => ({
  pc: null, // send-only connection
  pullPc: null, // receive-only connection
  config: null,
  roomID: null,
  sessionId: null,
  onFailed: null,
  queue: Promise.resolve(), // send negotiations
  pullQueue: Promise.resolve(), // receive negotiations (independent of sending)
  published: { audio: null, video: null, screen: null }, // { producerID, mid, transceiver }
  pulled: new Set(), // producerIDs requested/pulled on this connection
  midToProducer: new Map(), // mid -> { producerID, socketID, userID }
  timers: new Map(), // connection -> pending 'disconnected' give-up timer
  retries: new Map(), // producerID -> pull attempts used
  retryTimers: new Set(),
  sendUsed: false, // the send session has carried a track at some point
  pullUsed: false, // the receive session has pulled a track at some point
  nextSendSession: null, // promise of a send session created ahead of time (see prepareNextSendSession)
  pullStale: false, // the last pull failed in a way a fresh receive session may fix
  failedNotified: false,
});

let s = fresh();

// SDP negotiation on one PeerConnection must be strictly sequential (a push and a close
// racing each other would collide on signalingState); sending and receiving are separate
// connections, so they have separate queues and never block each other.
const enqueue = (fn, receiving = false) => {
  const key = receiving ? 'pullQueue' : 'queue';
  const run = s[key].then(fn);
  s[key] = run.catch(() => {});
  return run;
};

// io.request rejects with Error(code) when the server acks { error: code }.
const ask = (event, payload) =>
  getIO()
    .request(event, payload)
    .catch((err) => {
      // The server only sends a short code; the console names which request failed.
      console.warn('call request failed:', event, err && err.message);
      throw err;
    });

const randomId = () => Math.random().toString(36).slice(2, 10);

const waitConnected = (pc, ms) =>
  new Promise((resolve) => {
    if (pc.connectionState === 'connected') {
      resolve();
      return;
    }
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('connectionstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (['connected', 'failed', 'closed'].includes(pc.connectionState)) done();
    };
    timer = setTimeout(done, ms);
    pc.addEventListener('connectionstatechange', onChange);
  });

// A track is only announced to the room once packets are really leaving the browser. When the
// connection is already up (every on/off after the first), "connected" says nothing about the NEW
// track: announce it at once and the other side's pull reaches Cloudflare before any media has
// arrived and is refused (empty_track_error), so the feature seemed to work only once. Best effort:
// gives up after `ms` and announces anyway (a muted/static source may legitimately send little).
const waitSending = async (sender, ms) => {
  if (!sender || typeof sender.getStats !== 'function') return;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const report = await sender.getStats();
      let sent = 0;
      report.forEach((stat) => {
        if (stat.type === 'outbound-rtp') sent = Math.max(sent, stat.packetsSent || 0);
      });
      if (sent > 0) return;
    } catch (e) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
};

// Rolls back a half-applied local offer so the next negotiation starts clean.
const rollback = async (pc) => {
  try {
    if (pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' });
  } catch (e) {
    /* nothing to roll back */
  }
};

// The Meeting UI captures the camera with a bare `{ video: true }` (usually 640x480).
// Ask the camera for the cap resolution / 30fps before publishing, so what we send
// is sharp instead of an upscaled low-res frame. Best effort: a camera that can't
// do it just keeps what it has.
// WebRTC begins every call with a low bandwidth estimate (~300 kbps) and ramps up slowly,
// so video is blurry for a long stretch no matter what the bitrate cap is (measured live:
// 640x360 at ~200-300 kbps, "limited by bandwidth"). Chrome honours x-google-start-bitrate
// on the remote description's video codecs as the sender's starting bitrate; the estimator
// still backs off immediately if the network can't take it. Exported for tests.
export const withStartBitrate = (sdp, kbps, onlyMid = null) => {
  const param = `x-google-start-bitrate=${kbps}`;
  const lines = sdp.split(/\r?\n/);
  // Payload numbers are per m-section (Cloudflare numbers them differently in every section), so
  // codecs are resolved section by section; touching another section's payload (e.g. RTX) makes
  // Chrome reject the whole description. Only active video sections, and only `onlyMid` if given.
  const sections = [];
  lines.forEach((line) => {
    if (line.startsWith('m=')) sections.push([]);
    if (sections.length) sections[sections.length - 1].push(line);
  });
  const head = lines.slice(0, lines.findIndex((l) => l.startsWith('m=')));
  const body = sections.map((sec) => {
    const [mline] = sec;
    const port = mline.split(' ')[1];
    const mid = (sec.find((l) => l.startsWith('a=mid:')) || '').slice(6);
    if (!mline.startsWith('m=video') || port === '0' || (onlyMid !== null && mid !== String(onlyMid))) return sec;
    const codecs = new Set();
    const hasFmtp = new Set();
    sec.forEach((line) => {
      const rtp = line.match(/^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i);
      if (rtp) codecs.add(rtp[1]);
      const fmtp = line.match(/^a=fmtp:(\d+) /);
      if (fmtp) hasFmtp.add(fmtp[1]);
    });
    const out = [];
    sec.forEach((line) => {
      const fmtp = line.match(/^a=fmtp:(\d+) /);
      if (fmtp && codecs.has(fmtp[1]) && !line.includes('x-google-start-bitrate')) {
        out.push(`${line};${param}`);
        return;
      }
      out.push(line);
      const rtp = line.match(/^a=rtpmap:(\d+) /);
      if (rtp && codecs.has(rtp[1]) && !hasFmtp.has(rtp[1])) out.push(`a=fmtp:${rtp[1]} ${param}`);
    });
    return out;
  });
  return [...head, ...body.flat()].join('\r\n');
};

const improveCapture = async (track, slot) => {
  try {
    track.contentHint = slot === 'screen' ? 'detail' : slot === 'video' ? 'motion' : track.contentHint;
  } catch (e) {
    /* contentHint unsupported */
  }
  if (slot !== 'video') return;
  const maxHeight = (s.config && s.config.limits && s.config.limits.maxVideoHeight) || 720;
  try {
    await track.applyConstraints({
      width: { ideal: Math.round((maxHeight * 16) / 9) },
      height: { ideal: maxHeight },
      frameRate: { ideal: 30 },
    });
  } catch (e) {
    /* keep the existing capture settings */
  }
};

const applySenderLimits = async (sender, track, slot) => {
  try {
    const limits = (s.config && s.config.limits) || {};
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    const encoding = params.encodings[0];
    if (slot === 'audio') {
      if (limits.maxAudioBitrate) encoding.maxBitrate = limits.maxAudioBitrate;
    } else if (slot === 'screen') {
      if (limits.maxScreenBitrate) encoding.maxBitrate = limits.maxScreenBitrate;
    } else {
      if (limits.maxVideoBitrate) encoding.maxBitrate = limits.maxVideoBitrate;
      encoding.maxFramerate = 30;
      const height = track.getSettings && track.getSettings().height;
      if (height && limits.maxVideoHeight && height > limits.maxVideoHeight) {
        encoding.scaleResolutionDownBy = height / limits.maxVideoHeight;
      }
    }
    await sender.setParameters(params);
  } catch (e) {
    /* best effort: the call works without the caps */
  }
};

const isCurrent = (pc) => pc === s.pc || pc === s.pullPc;

const notifyFailed = (pc) => {
  if (!isCurrent(pc) || s.failedNotified) return;
  s.failedNotified = true;
  if (s.onFailed) s.onFailed();
};

const onConnectionStateChange = (pc) => () => {
  if (!isCurrent(pc)) return;
  clearTimeout(s.timers.get(pc));
  if (pc.connectionState === 'failed') {
    notifyFailed(pc);
  } else if (pc.connectionState === 'disconnected') {
    // 'disconnected' often heals by itself (Wi-Fi blip); only give up if it persists.
    s.timers.set(pc, setTimeout(() => notifyFailed(pc), 8000));
  }
};

const onTrack = (event) => {
  const info = s.midToProducer.get(String(event.transceiver && event.transceiver.mid));
  if (!info) return;
  const { streams } = getGlobal();
  if (streams.some((x) => x.producerID === info.producerID)) return;
  const stream = new MediaStream([event.track]);
  stream.isVideo = event.track.kind === 'video';
  stream.producerID = info.producerID;
  stream.socketID = info.socketID;
  stream.userID = info.userID;
  setGlobal({ streams: [...streams, stream] });
};

const requirePc = () => {
  if (!s.pc) throw new Error('call_not_connected');
  return s.pc;
};

const requirePullPc = () => {
  if (!s.pullPc) throw new Error('call_not_connected');
  return s.pullPc;
};

// Tears down the connection only. Local camera/mic tracks are released by
// callManager.releaseAllMedia(), not here.
export function close() {
  s.timers.forEach((timer) => clearTimeout(timer));
  s.retryTimers.forEach((timer) => clearTimeout(timer));
  if (s.nextSendSession) s.nextSendSession.catch(() => {});
  const old = [s.pc, s.pullPc];
  s = fresh();
  old.forEach((pc) => {
    if (!pc) return;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch (e) {
      /* already closed */
    }
  });
}

const makePc = () => new RTCPeerConnection({ iceServers: (s.config && s.config.iceServers) || [], bundlePolicy: 'max-bundle' });

// Cloudflare tears down a session's transport when its last track is closed, so anything published on
// that session afterwards is never received (empty_track_error / transport_unavailable_error for every
// subscriber): turning the mic, camera or screen off and on again worked only once. Whenever publishing
// starts and nothing is currently published, swap in a brand new send connection and session. The
// receive connection is untouched.
const refreshSendConnection = async () => {
  const pending = s.nextSendSession;
  s.nextSendSession = null;
  const { sessionId } = await (pending || ask('cf:session:new', { sendOnly: true }));
  const old = s.pc;
  s.pc = makePc();
  s.pc.onconnectionstatechange = onConnectionStateChange(s.pc);
  s.sessionId = sessionId;
  s.sendUsed = false;
  clearTimeout(s.timers.get(old));
  s.timers.delete(old);
  if (old) {
    old.onconnectionstatechange = null;
    try {
      old.close();
    } catch (e) {
      /* already closed */
    }
  }
};

// Creating the new send session takes a round trip to our server and one to Cloudflare. Do it as soon
// as the last track is turned off, while nothing is waiting on it, so turning something back on only
// has to connect. Best effort: a failure here just means the session is created on demand instead.
const prepareNextSendSession = () => {
  if (s.nextSendSession) return;
  const pending = ask('cf:session:new', { sendOnly: true });
  s.nextSendSession = pending;
  pending.catch(() => {
    if (s.nextSendSession === pending) s.nextSendSession = null;
  });
};

// Same problem on the receiving side: a receive session with nothing live on it is disconnected by
// Cloudflare (410 "Session appears to be disconnected"), after which every pull on it fails. Before a
// pull, if nothing is currently being received (or the last pull failed), use a new receive connection.
const refreshPullConnection = async () => {
  const { pullSessionId } = await ask('cf:session:new', { pullOnly: true });
  const old = s.pullPc;
  s.pullPc = makePc();
  s.pullPc.ontrack = onTrack;
  s.pullPc.onconnectionstatechange = onConnectionStateChange(s.pullPc);
  s.midToProducer.clear();
  s.pullUsed = false;
  s.pullStale = false;
  if (old) {
    clearTimeout(s.timers.get(old));
    s.timers.delete(old);
    old.ontrack = null;
    old.onconnectionstatechange = null;
    try {
      old.close();
    } catch (e) {
      /* already closed */
    }
  }
  return pullSessionId;
};

// Opens the Cloudflare sessions + the two PeerConnections (send / receive). `renew` asks the server to drop
// this socket's old tracks first (used when only the media connection died).
export async function start({ roomID, config, renew = false, onFailed = null }) {
  close();
  s.roomID = roomID;
  s.config = config;
  s.onFailed = onFailed;

  const { sessionId } = await ask('cf:session:new', renew ? { renew: true } : {});
  s.sessionId = sessionId;
  s.pc = makePc();
  s.pullPc = makePc();
  s.pullPc.ontrack = onTrack;
  [s.pc, s.pullPc].forEach((pc) => {
    pc.onconnectionstatechange = onConnectionStateChange(pc);
  });
}

// Condensed view of one m-section (codec/extension lines only) for the rejection diagnostic.
const sectionOf = (sdp, mid) => {
  const lines = sdp.split(/\r?\n/);
  const out = [];
  let keep = false;
  let current = [];
  lines.forEach((line) => {
    if (line.startsWith('m=')) {
      if (keep) out.push(...current);
      current = [];
      keep = false;
    }
    if (line === `a=mid:${mid}`) keep = true;
    if (/^(m=|a=(mid|rtpmap|fmtp|extmap|sendonly|recvonly|inactive))/.test(line)) current.push(line);
  });
  if (keep) out.push(...current);
  return out;
};

async function sendOnce(pc, { slot, kind, track, stream, isScreen }) {
  const trackName = `${slot}-${randomId()}`;
  const transceiver = pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
  const discard = async () => {
    await rollback(pc);
    try {
      transceiver.stop();
    } catch (e) {
      /* already stopped */
    }
  };
  let offer;
  let res;
  try {
    offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await applySenderLimits(transceiver.sender, track, slot);
    res = await ask('cf:tracks:push', {
      sessionDescription: offer.sdp,
      tracks: [{ mid: transceiver.mid, trackName, kind, isScreen }],
    });
  } catch (err) {
    await discard();
    throw err;
  }
  const { mid } = transceiver;
  const startKbps = Math.round((((s.config && s.config.limits && s.config.limits.maxVideoBitrate) || 1500000) / 1000) * 0.7);
  const answer = kind === 'audio' ? res.sessionDescription : withStartBitrate(res.sessionDescription, startKbps, mid);
  try {
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  } catch (err) {
    // A rejected answer must not leave the connection stuck mid-negotiation (every later
    // offer would fail): roll back, drop the half-registered tracks, free the transceiver.
    await discard();
    ask('cf:tracks:close', { closes: res.producerIDs.map((producerID) => ({ producerID, mid })) }).catch(() => {});
    // eslint-disable-next-line no-console
    console.warn('cloudflare answer rejected', err.message, { slot, mid, offer: sectionOf(offer.sdp, mid), answer: sectionOf(answer, mid) });
    throw err;
  }
  if (!res.producerIDs.length) throw new Error('track_rejected');

  // Tell the room only once media can actually flow, so nobody pulls a dead track.
  await waitConnected(pc, 8000);
  await waitSending(transceiver.sender, 6000);
  await ask('cf:tracks:ready', { producerIDs: res.producerIDs });
  return { producerID: res.producerIDs[0], mid, transceiver };
}

// slot: 'audio' | 'video' | 'screen'. Replaces whatever is already published in the slot.
export async function produce(slot, stream, { isScreen = false } = {}) {
  const kind = slot === 'audio' ? 'audio' : 'video';
  const track = (kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks())[0];
  if (!track) throw new Error('no_track');
  if (s.published[slot]) await unpublish(slot);

  return enqueue(async () => {
    requirePc();
    const needsFreshSend = s.sendUsed && !Object.values(s.published).some(Boolean);
    // Capture tuning and the connection swap are independent: do them together.
    await Promise.all([improveCapture(track, slot), needsFreshSend ? refreshSendConnection() : null]);
    try {
      s.published[slot] = await sendOnce(requirePc(), { slot, kind, track, stream, isScreen });
    } catch (err) {
      // Cloudflare refusing the publish usually means the send session went stale (idle, or its
      // transport was dropped). Start over on a brand new send connection and session, once.
      if (!err || (err.message !== 'call_request_failed' && !/^Timed out/.test(err.message))) throw err;
      console.warn('publish failed; retrying on a fresh send connection');
      await refreshSendConnection();
      s.published[slot] = await sendOnce(requirePc(), { slot, kind, track, stream, isScreen });
    }
    s.sendUsed = true;
  });
}

export async function unpublish(slot) {
  const published = s.published[slot];
  if (!published || !s.pc) return undefined;
  s.published[slot] = null;
  return enqueue(async () => {
    requirePc();
    // Forced close on the SFU (no renegotiation: Cloudflare's answer to an inactive-track
    // offer reassigns an RTP header-extension ID that Chrome rejects), then stop the
    // transceiver locally so the next offer carries it as a closed m-line.
    await ask('cf:tracks:close', { closes: [{ producerID: published.producerID, mid: published.mid }] });
    try {
      published.transceiver.stop();
    } catch (e) {
      /* already stopped */
    }
    if (!Object.values(s.published).some(Boolean)) prepareNextSendSession();
  });
}

// Cloudflare refuses a pull while the publisher's media has not reached it yet (empty_track_error).
// That is transient, so retry a few times with growing delays instead of giving up for good.
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000];
const scheduleRetry = (producerID) => {
  const used = s.retries.get(producerID) || 0;
  if (used >= RETRY_DELAYS_MS.length) return;
  s.retries.set(producerID, used + 1);
  const timer = setTimeout(() => {
    s.retryTimers.delete(timer);
    // eslint-disable-next-line no-use-before-define
    onProducersChanged();
  }, RETRY_DELAYS_MS[used]);
  s.retryTimers.add(timer);
};

const pullBatch = async (batch) => {
  requirePullPc();
  const batchIds = new Set(batch.map((p) => p.producerID));
  const liveElsewhere = [...s.pulled].some((id) => !batchIds.has(id));
  if (s.pullStale || (s.pullUsed && !liveElsewhere)) await refreshPullConnection();
  const pc = requirePullPc();
  let res;
  try {
    res = await ask('cf:tracks:pull', { producerIDs: batch.map((p) => p.producerID) });
  } catch (err) {
    // Cloudflare errors (as opposed to our own validation codes) may mean the receive session died.
    if (err && err.message === 'call_request_failed') s.pullStale = true;
    throw err;
  }
  // Tracks Cloudflare could not serve yet: forget them (so the next pass asks again) and retry soon.
  (res.tracks || []).forEach((t) => {
    if (!t.error) return;
    s.pulled.delete(t.producerID);
    scheduleRetry(t.producerID);
  });
  // Record mid -> producer BEFORE applying the offer: ontrack fires inside setRemoteDescription.
  (res.tracks || []).forEach((t) => {
    if (t.error) return;
    const producer = batch.find((p) => p.producerID === t.producerID) || {};
    s.midToProducer.set(String(t.mid), {
      producerID: t.producerID,
      socketID: t.socketID || producer.socketID,
      userID: producer.userID,
    });
  });
  if (!res.sessionDescription) return;
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: res.sessionDescription });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await ask('cf:renegotiate', { sessionDescription: answer.sdp });
    s.pullUsed = true; // a track is now really flowing on this receive session
  } catch (err) {
    await rollback(pc);
    throw err;
  }
};

// Pulls any remote producer in Redux we haven't subscribed to yet (on the receive connection). Called from
// callManager whenever rtc.producers changes (and after (re)connecting).
export function onProducersChanged() {
  if (!s.pullPc) return;
  const { producers } = store.getState().rtc;
  const myId = getIO().id;
  const live = new Set(producers.map((p) => p.producerID));
  s.pulled.forEach((id) => {
    if (!live.has(id)) s.pulled.delete(id);
  });

  // Nothing live is being received any more: Cloudflare will drop this receive session, so swap in a new
  // one now (in the background) rather than at the moment the next remote track needs pulling.
  if (s.pullUsed && s.pulled.size === 0) {
    enqueue(() => (s.pullUsed && s.pulled.size === 0 ? refreshPullConnection() : null), true).catch((err) =>
      console.warn('could not prepare a new receive connection:', err && err.message),
    );
  }

  const todo = producers.filter((p) => p.roomID === s.roomID && p.socketID !== myId && !s.pulled.has(p.producerID));
  if (!todo.length) return;
  todo.forEach((p) => s.pulled.add(p.producerID));

  const batches = Array.from({ length: Math.ceil(todo.length / 8) }, (_, i) => todo.slice(i * 8, i * 8 + 8));
  batches.forEach((batch) => {
    enqueue(() => pullBatch(batch), true).catch((err) => {
      // Forget them so the next producers change (or the retry below) asks again.
      batch.forEach((p) => {
        s.pulled.delete(p.producerID);
        scheduleRetry(p.producerID);
      });
      console.log('cloudflare pull failed', err && err.message);
    });
  });
}

export const isActive = () => !!s.pc;

