/* eslint-disable max-classes-per-file */
// Three tiny browser fakes (track, stream, RTCPeerConnection) live together on purpose.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared mutable fakes, hoisted so the vi.mock factories below can see them.
const h = vi.hoisted(() => ({
  globalState: { streams: [] },
  reduxState: { io: { io: null }, rtc: { producers: [] } },
}));

vi.mock('reactn', () => ({
  getGlobal: () => h.globalState,
  setGlobal: async (patch) => {
    Object.assign(h.globalState, patch);
  },
}));
vi.mock('../store', () => ({ default: { getState: () => h.reduxState } }));

// ---- fake WebRTC ---------------------------------------------------------------
class FakeTrack {
  constructor(kind, height) {
    this.kind = kind;
    this.height = height;
  }

  getSettings() {
    return { height: this.height };
  }
}
class FakeStream {
  constructor(tracks = []) {
    this.tracks = tracks;
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let pcs;
class FakePC {
  constructor(config) {
    this.config = config;
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.transceivers = [];
    this.listeners = [];
    this.log = [];
    this.remoteTracksOnOffer = []; // [{ mid, track }] "arrive" when an offer is applied
    this.closed = false;
    this.rejectAnswers = 0; // tests: reject the next N answers, like Chrome on a bad send section
    pcs.push(this);
  }

  addTransceiver(track, init) {
    const t = {
      track,
      direction: init.direction,
      mid: null,
      stop: vi.fn(),
      sender: { params: null, getParameters: () => ({ encodings: [] }), setParameters: vi.fn(async function set(p) { this.params = p; }) },
    };
    this.transceivers.push(t);
    return t;
  }

  async createOffer() {
    return { type: 'offer', sdp: `offer#${this.log.length}` };
  }

  async createAnswer() {
    return { type: 'answer', sdp: `answer#${this.log.length}` };
  }

  async setLocalDescription(d) {
    this.log.push(`setLocal:${d.type}`);
    if (d.type === 'offer') {
      this.signalingState = 'have-local-offer';
      this.transceivers.forEach((t, i) => {
        if (t.mid === null) t.mid = String(i);
      });
    } else this.signalingState = 'stable';
  }

  async setRemoteDescription(d) {
    this.log.push(`setRemote:${d.type}`);
    if (d.type === 'answer' && this.rejectAnswers > 0) {
      this.rejectAnswers -= 1;
      throw new Error('Failed to set remote video description send parameters');
    }
    if (d.type === 'answer') {
      this.signalingState = 'stable';
      this.setConnectionState('connected');
    } else {
      this.signalingState = 'have-remote-offer';
      this.remoteTracksOnOffer.forEach(({ mid, track }) => this.ontrack({ track, transceiver: { mid } }));
    }
  }

  setConnectionState(state) {
    this.connectionState = state;
    this.listeners.forEach((fn) => fn());
    if (this.onconnectionstatechange) this.onconnectionstatechange();
  }

  addEventListener(type, fn) {
    this.listeners.push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((x) => x !== fn);
  }

  close() {
    this.closed = true;
  }
}

// ---- fake server (mirrors backend/src/calls/cloudflare behaviour) ---------------
let requests;
let failNext;
const makeIO = () => {
  let session = 0;
  return {
    id: 'me',
    request: vi.fn(async (event, payload) => {
      requests.push({ event, payload });
      if (failNext && failNext.event === event) {
        const scripted = failNext;
        failNext = null;
        if (scripted.result) return scripted.result; // a scripted (non-error) reply
        throw new Error(scripted.code);
      }
      switch (event) {
        case 'cf:session:new':
          session += 1;
          return { sessionId: `sess-${session}` };
        case 'cf:tracks:push':
          return {
            sessionDescription: 'ANSWER',
            producerIDs: payload.tracks.map((t) => `sess-${session}/${t.trackName}`),
            rejected: [],
          };
        case 'cf:tracks:ready':
          return { announced: payload.producerIDs.length };
        case 'cf:tracks:pull':
          return {
            sessionDescription: 'PULL-OFFER',
            requiresImmediateRenegotiation: true,
            tracks: payload.producerIDs.map((producerID, i) => ({ mid: String(10 + i), producerID, socketID: 'peer-socket', kind: 'audio' })),
          };
        case 'cf:renegotiate':
          return { ok: true };
        case 'cf:tracks:close':
          return { ok: true };
        default:
          throw new Error(`unexpected event ${event}`);
      }
    }),
  };
};

let engine;
const config = {
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
  limits: { maxVideoHeight: 360, maxVideoBitrate: 600000, maxScreenBitrate: 1500000, maxAudioBitrate: 40000 },
};

beforeEach(async () => {
  pcs = [];
  requests = [];
  failNext = null;
  h.globalState.streams = [];
  h.reduxState.io.io = makeIO();
  h.reduxState.rtc.producers = [];
  vi.stubGlobal('RTCPeerConnection', FakePC);
  vi.stubGlobal('MediaStream', FakeStream);
  vi.resetModules();
  engine = await import('./cloudflareCall');
});

const started = async (extra = {}) => {
  await engine.start({ roomID: 'room-1', config, ...extra });
  // start() makes two connections: [send, receive]. Return the send one; the receive one is `.recv`.
  const send = pcs[pcs.length - 2];
  send.recv = pcs[pcs.length - 1];
  return send;
};
const events = () => requests.map((r) => r.event);

describe('withStartBitrate', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
    'a=rtpmap:96 VP8/90000',
    'a=rtpmap:97 rtx/90000',
    'a=fmtp:97 apt=96',
    'a=rtpmap:98 H264/90000',
    'a=fmtp:98 level-asymmetry-allowed=1;profile-level-id=42e01f',
    '',
  ].join('\r\n');

  it('adds the start bitrate to video codecs only, creating or extending fmtp lines', async () => {
    const { withStartBitrate } = engine;
    const out = withStartBitrate(sdp, 1000).split('\r\n');
    expect(out).toContain('a=fmtp:96 x-google-start-bitrate=1000'); // VP8 had no fmtp: created
    expect(out).toContain('a=fmtp:98 level-asymmetry-allowed=1;profile-level-id=42e01f;x-google-start-bitrate=1000');
    expect(out).toContain('a=fmtp:97 apt=96'); // rtx untouched
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1'); // audio untouched
  });

  it('resolves codecs per m-section and can be limited to one mid (payload numbers differ per section)', async () => {
    const { withStartBitrate } = engine;
    // Section 0 (mid 3): 96 is VP8. Section 1 (mid 4): 96 is RTX and 100 is VP8. Closed section untouched.
    const multi = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'a=mid:3',
      'a=rtpmap:96 VP8/90000',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 100',
      'a=mid:4',
      'a=rtpmap:96 rtx/90000',
      'a=fmtp:96 apt=100',
      'a=rtpmap:100 VP8/90000',
      'm=video 0 UDP/TLS/RTP/SAVPF 96',
      'a=mid:5',
      'a=rtpmap:96 VP8/90000',
      '',
    ].join('\r\n');
    const all = withStartBitrate(multi, 700).split('\r\n');
    expect(all).toContain('a=fmtp:96 apt=100'); // RTX in mid 4 never gets the parameter
    expect(all).toContain('a=fmtp:100 x-google-start-bitrate=700');
    expect(all.filter((l) => l === 'a=fmtp:96 x-google-start-bitrate=700')).toHaveLength(1); // mid 3 only
    const onlyFour = withStartBitrate(multi, 700, '4').split('\r\n');
    expect(onlyFour).not.toContain('a=fmtp:96 x-google-start-bitrate=700');
    expect(onlyFour).toContain('a=fmtp:100 x-google-start-bitrate=700');
  });

  it('is idempotent and leaves audio-only SDP alone', async () => {
    const { withStartBitrate } = engine;
    const once = withStartBitrate(sdp, 1000);
    expect(withStartBitrate(once, 1000)).toBe(once);
    const audioOnly = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';
    expect(withStartBitrate(audioOnly, 1000)).toBe(audioOnly);
  });
});

describe('start', () => {
  it('opens a session and separate send and receive max-bundle connections with the server-provided ICE servers', async () => {
    const pc = await started();
    expect(events()).toEqual(['cf:session:new']);
    expect(pcs).toHaveLength(2);
    expect(pc.config).toEqual({ iceServers: config.iceServers, bundlePolicy: 'max-bundle' });
    expect(pc.recv.config).toEqual(pc.config);
    expect(pc.recv).not.toBe(pc);
    expect(pc.recv.ontrack).toEqual(expect.any(Function)); // only the receive connection surfaces remote tracks
    expect(pc.ontrack).toBeUndefined();
    expect(engine.isActive()).toBe(true);
  });

  it('asks the server to renew when only the media connection died', async () => {
    await started({ renew: true });
    expect(requests[0]).toEqual({ event: 'cf:session:new', payload: { renew: true } });
  });
});

describe('publishing', () => {
  it('negotiates, applies bitrate caps, waits for media, then announces the track', async () => {
    const pc = await started();
    const mic = new FakeStream([new FakeTrack('audio')]);
    await engine.produce('audio', mic);

    expect(events()).toEqual(['cf:session:new', 'cf:tracks:push', 'cf:tracks:ready']);
    const push = requests[1].payload;
    expect(push.sessionDescription).toMatch(/^offer#/);
    expect(push.tracks).toEqual([{ mid: '0', trackName: expect.stringMatching(/^audio-/), kind: 'audio', isScreen: false }]);
    expect(pc.log).toEqual(['setLocal:offer', 'setRemote:answer']);
    expect(pc.transceivers[0].direction).toBe('sendonly');
    expect(pc.transceivers[0].sender.setParameters).toHaveBeenCalled();
    expect(requests[2].payload.producerIDs).toHaveLength(1);
  });

  it('downscales camera video to the 360p cap and caps its bitrate', async () => {
    const pc = await started();
    await engine.produce('video', new FakeStream([new FakeTrack('video', 720)]));
    const params = pc.transceivers[0].sender.setParameters.mock.calls[0][0];
    expect(params.encodings[0]).toMatchObject({ maxBitrate: 600000, scaleResolutionDownBy: 2 });
  });

  it('does not downscale a camera that is already at or below 360p', async () => {
    const pc = await started();
    await engine.produce('video', new FakeStream([new FakeTrack('video', 360)]));
    expect(pc.transceivers[0].sender.setParameters.mock.calls[0][0].encodings[0].scaleResolutionDownBy).toBeUndefined();
  });

  it('flags screen shares so the room can tell them apart', async () => {
    await started();
    await engine.produce('screen', new FakeStream([new FakeTrack('video', 1080)]), { isScreen: true });
    expect(requests.find((r) => r.event === 'cf:tracks:push').payload.tracks[0]).toMatchObject({ kind: 'video', isScreen: true });
  });

  it('serializes concurrent publishes so SDP negotiations never interleave', async () => {
    const pc = await started();
    await Promise.all([
      engine.produce('audio', new FakeStream([new FakeTrack('audio')])),
      engine.produce('video', new FakeStream([new FakeTrack('video', 360)])),
    ]);
    expect(events().slice(1)).toEqual(['cf:tracks:push', 'cf:tracks:ready', 'cf:tracks:push', 'cf:tracks:ready']);
    expect(pc.log).toEqual(['setLocal:offer', 'setRemote:answer', 'setLocal:offer', 'setRemote:answer']);
  });

  it('rolls back and releases the transceiver when the server refuses, and keeps working afterwards', async () => {
    const pc = await started();
    failNext = { event: 'cf:tracks:push', code: 'too_many_tracks' };
    await expect(engine.produce('audio', new FakeStream([new FakeTrack('audio')]))).rejects.toThrow('too_many_tracks');
    expect(pc.log).toContain('setLocal:offer');
    expect(pc.signalingState).toBe('stable'); // rolled back, not stuck in have-local-offer
    expect(pc.transceivers[0].stop).toHaveBeenCalled();

    await engine.produce('video', new FakeStream([new FakeTrack('video', 360)])); // queue not poisoned
    expect(events()).toContain('cf:tracks:ready');
  });

  it('never mixes directions: publishing touches only the send connection, pulling only the receive one', async () => {
    const send = await started();
    await engine.produce('audio', new FakeStream([new FakeTrack('audio')]));
    h.reduxState.rtc.producers = [{ producerID: 'sess-9/audio-x', roomID: 'room-1', socketID: 'peer', userID: 'u', kind: 'audio' }];
    send.recv.remoteTracksOnOffer = [{ mid: '10', track: new FakeTrack('audio') }];
    engine.onProducersChanged();
    await vi.waitFor(() => expect(events()).toContain('cf:renegotiate'));
    expect(send.log).toEqual(['setLocal:offer', 'setRemote:answer']); // no offer/answer from pulling
    expect(send.recv.log).toEqual(['setRemote:offer', 'setLocal:answer']); // no send negotiation
  });

  it('rolls back and drops the tracks when the browser rejects the answer, without poisoning the queue', async () => {
    const pc = await started();
    pc.rejectAnswers = 1;
    await expect(engine.produce('video', new FakeStream([new FakeTrack('video', 720)]))).rejects.toThrow('send parameters');
    expect(events()).toContain('cf:tracks:close'); // the half-registered track is removed from the room
    expect(pc.transceivers[0].stop).toHaveBeenCalled();
    expect(pc.signalingState).toBe('stable');
    await engine.produce('audio', new FakeStream([new FakeTrack('audio')]));
    expect(events()).toContain('cf:tracks:ready');
  });

  it('gets a fresh send connection and session when publishing restarts after the last track was closed', async () => {
    const send = await started();
    const mic = () => new FakeStream([new FakeTrack('audio')]);
    await engine.produce('audio', mic());
    await engine.unpublish('audio'); // the send session is now empty: Cloudflare drops its transport
    const before = pcs.length;

    await engine.produce('audio', mic());

    expect(requests.filter((r) => r.event === 'cf:session:new').map((r) => r.payload)).toEqual([{}, { sendOnly: true }]);
    expect(pcs.length).toBe(before + 1); // a new send connection (the receive one is untouched)
    expect(send.closed).toBe(true);
    expect(send.recv.closed).toBe(false);
    expect(events().filter((e) => e === 'cf:tracks:ready')).toHaveLength(2);
  });

  it('keeps the send connection while another track is still published', async () => {
    const send = await started();
    await engine.produce('audio', new FakeStream([new FakeTrack('audio')]));
    await engine.produce('video', new FakeStream([new FakeTrack('video', 720)]));
    await engine.unpublish('video'); // audio still carries the session
    const before = pcs.length;

    await engine.produce('video', new FakeStream([new FakeTrack('video', 720)]));

    expect(events().filter((e) => e === 'cf:session:new')).toHaveLength(1);
    expect(pcs.length).toBe(before);
    expect(send.closed).toBe(false);
  });

  it('rejects a stream with no usable track', async () => {
    await started();
    await expect(engine.produce('audio', new FakeStream([]))).rejects.toThrow('no_track');
  });

  it('force-closes a published track by mid and stops the transceiver, without renegotiating', async () => {
    const pc = await started();
    await engine.produce('audio', new FakeStream([new FakeTrack('audio')]));
    const producerID = requests.find((r) => r.event === 'cf:tracks:ready').payload.producerIDs[0];
    requests.length = 0;
    const logBefore = [...pc.log];

    await engine.unpublish('audio');
    expect(requests).toHaveLength(1);
    expect(requests[0].event).toBe('cf:tracks:close');
    expect(requests[0].payload).toEqual({ closes: [{ producerID, mid: '0' }] });
    expect(pc.transceivers[0].stop).toHaveBeenCalled();
    expect(pc.log).toEqual(logBefore); // no new SDP exchange
  });

  it('unpublish is a no-op for a slot that was never published', async () => {
    await started();
    await expect(engine.unpublish('screen')).resolves.toBeUndefined();
    expect(events()).toEqual(['cf:session:new']);
  });

  it('fails clearly when there is no connection', async () => {
    await expect(engine.produce('audio', new FakeStream([new FakeTrack('audio')]))).rejects.toThrow('call_not_connected');
  });
});

describe('subscribing', () => {
  const remote = (id, extra = {}) => ({ producerID: id, roomID: 'room-1', socketID: 'peer-socket', userID: 'peer-user', kind: 'audio', ...extra });

  it('pulls new remote producers, answers the offer, and surfaces them as streams', async () => {
    const pc = (await started()).recv;
    pc.remoteTracksOnOffer = [{ mid: '10', track: new FakeTrack('audio') }];
    h.reduxState.rtc.producers = [remote('sess-9/audio-x')];

    engine.onProducersChanged();
    await vi.waitFor(() => expect(events()).toContain('cf:renegotiate'));

    expect(events().slice(1)).toEqual(['cf:tracks:pull', 'cf:renegotiate']);
    expect(requests[1].payload).toEqual({ producerIDs: ['sess-9/audio-x'] });
    expect(pc.log).toEqual(['setRemote:offer', 'setLocal:answer']);
    expect(h.globalState.streams).toHaveLength(1);
    expect(h.globalState.streams[0]).toMatchObject({ producerID: 'sess-9/audio-x', socketID: 'peer-socket', userID: 'peer-user', isVideo: false });
  });

  it('ignores our own tracks and producers from other rooms', async () => {
    await started();
    h.reduxState.rtc.producers = [remote('sess-1/mine', { socketID: 'me' }), remote('sess-7/other-room', { roomID: 'room-2' })];
    engine.onProducersChanged();
    await sleep(10);
    expect(events()).toEqual(['cf:session:new']);
  });

  it('does not pull the same producer twice, but pulls a re-published one', async () => {
    const pc = (await started()).recv;
    pc.remoteTracksOnOffer = [{ mid: '10', track: new FakeTrack('audio') }];
    h.reduxState.rtc.producers = [remote('sess-9/audio-x')];
    engine.onProducersChanged();
    await vi.waitFor(() => expect(events()).toContain('cf:renegotiate'));
    engine.onProducersChanged(); // same list again
    await sleep(10);
    expect(events().filter((e) => e === 'cf:tracks:pull')).toHaveLength(1);

    // peer toggled their mic: old ID gone, new ID appears
    h.reduxState.rtc.producers = [];
    engine.onProducersChanged();
    h.reduxState.rtc.producers = [remote('sess-9/audio-y')];
    engine.onProducersChanged();
    await vi.waitFor(() => expect(events().filter((e) => e === 'cf:tracks:pull')).toHaveLength(2));
  });

  it('retries a pull Cloudflare refused because no media had arrived yet (empty_track_error)', async () => {
    vi.useFakeTimers();
    try {
      const send = await started();
      const recv = send.recv;
      recv.remoteTracksOnOffer = [{ mid: '10', track: new FakeTrack('audio') }];
      h.reduxState.rtc.producers = [remote('sess-9/audio-x')];
      failNext = { event: 'cf:tracks:pull', result: { tracks: [{ producerID: 'sess-9/audio-x', error: 'empty_track_error' }] } };

      engine.onProducersChanged();
      await vi.advanceTimersByTimeAsync(10);
      expect(events().filter((e) => e === 'cf:tracks:pull')).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(600); // first retry fires after 500 ms
      expect(events().filter((e) => e === 'cf:tracks:pull')).toHaveLength(2);
      expect(h.globalState.streams).toHaveLength(1); // second attempt succeeded
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed pull on the next producers change', async () => {
    await started();
    failNext = { event: 'cf:tracks:pull', code: 'producer_not_found' };
    h.reduxState.rtc.producers = [remote('sess-9/audio-x')];
    engine.onProducersChanged();
    await sleep(10);
    expect(events().filter((e) => e === 'cf:tracks:pull')).toHaveLength(1);

    engine.onProducersChanged(); // next change: forgotten, so retried
    await vi.waitFor(() => expect(events().filter((e) => e === 'cf:tracks:pull')).toHaveLength(2));
  });

  it('batches large pulls (8 per request)', async () => {
    await started();
    h.reduxState.rtc.producers = Array.from({ length: 10 }, (_, i) => remote(`sess-9/t-${i}`));
    engine.onProducersChanged();
    await vi.waitFor(() => expect(events().filter((e) => e === 'cf:tracks:pull')).toHaveLength(2));
    const sizes = requests.filter((r) => r.event === 'cf:tracks:pull').map((r) => r.payload.producerIDs.length);
    expect(sizes).toEqual([8, 2]);
  });
});

describe('connection health and teardown', () => {
  it('reports a failed connection once', async () => {
    const onFailed = vi.fn();
    const pc = await started({ onFailed });
    pc.setConnectionState('failed');
    pc.setConnectionState('failed');
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('tolerates a brief disconnect but reports one that persists', async () => {
    vi.useFakeTimers();
    try {
      const onFailed = vi.fn();
      const pc = await started({ onFailed });
      pc.setConnectionState('disconnected');
      vi.advanceTimersByTime(4000);
      pc.setConnectionState('connected'); // healed
      vi.advanceTimersByTime(10000);
      expect(onFailed).not.toHaveBeenCalled();

      pc.setConnectionState('disconnected');
      vi.advanceTimersByTime(9000);
      expect(onFailed).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() tears the connection down and detaches handlers', async () => {
    const pc = await started();
    engine.close();
    expect(pc.closed).toBe(true);
    expect(pc.recv.closed).toBe(true);
    expect(pc.recv.ontrack).toBeNull();
    expect(engine.isActive()).toBe(false);
  });

  it('a stale connection cannot fire the failure callback after a new one starts', async () => {
    const onFailed = vi.fn();
    const first = await started({ onFailed });
    await started({ onFailed });
    first.setConnectionState('failed');
    expect(onFailed).not.toHaveBeenCalled();
  });
});
