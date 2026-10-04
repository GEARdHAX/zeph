const { createCloudflareClient, CloudflareError, FALLBACK_ICE_SERVERS } = require('../src/calls/cloudflare/client');

const BASE = 'https://rtc.live.cloudflare.com/v1';

// Minimal fetch double: records every call and replays queued responses.
const makeFetch = (...responses) => {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = queue.shift() || { status: 200, json: {} };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: next.statusText || '',
      json: async () => {
        if (next.json === undefined) throw new Error('no body');
        return next.json;
      },
    };
  };
  fn.calls = calls;
  return fn;
};

const make = (fetchImpl, extra = {}) =>
  createCloudflareClient({ appId: 'APP', appSecret: 'SECRET', turnKeyId: 'KEY', turnApiToken: 'TURNTOKEN', fetchImpl, ...extra });

describe('Cloudflare Realtime client', () => {
  it('reports configuration state', () => {
    expect(make(makeFetch()).isConfigured()).toBe(true);
    expect(createCloudflareClient({ fetchImpl: makeFetch() }).isConfigured()).toBe(false);
    expect(createCloudflareClient({ appId: 'x', fetchImpl: makeFetch() }).isConfigured()).toBe(false);
    expect(make(makeFetch()).turnConfigured()).toBe(true);
    expect(createCloudflareClient({ appId: 'a', appSecret: 'b', fetchImpl: makeFetch() }).turnConfigured()).toBe(false);
  });

  it('creates a session with the app secret as a bearer token', async () => {
    const f = makeFetch({ status: 200, json: { sessionId: 'sess-1' } });
    await expect(make(f).newSession()).resolves.toBe('sess-1');
    expect(f.calls[0].url).toBe(`${BASE}/apps/APP/sessions/new`);
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer SECRET');
    // Cloudflare rejects `{}` here as a malformed sessionDescription: no body, no JSON header.
    expect(f.calls[0].init.body).toBeUndefined();
    expect(f.calls[0].init.headers['Content-Type']).toBeUndefined();
  });

  it('rejects a session response without a sessionId', async () => {
    await expect(make(makeFetch({ status: 200, json: {} })).newSession()).rejects.toThrow(CloudflareError);
  });

  it('pushes tracks as local tracks with the browser offer', async () => {
    const f = makeFetch({ status: 200, json: { sessionDescription: { type: 'answer', sdp: 'ANS' }, tracks: [] } });
    await make(f).pushTracks('sess-1', { sdp: 'OFFER', tracks: [{ mid: '0', trackName: 'audio-a', kind: 'audio' }] });
    expect(f.calls[0].url).toBe(`${BASE}/apps/APP/sessions/sess-1/tracks/new`);
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].body).toEqual({
      sessionDescription: { type: 'offer', sdp: 'OFFER' },
      tracks: [{ location: 'local', mid: '0', trackName: 'audio-a' }],
    });
  });

  it('pulls remote tracks by publisher session and track name', async () => {
    const f = makeFetch({ status: 200, json: { requiresImmediateRenegotiation: true } });
    await make(f).pullTracks('sess-b', [{ sessionId: 'sess-a', trackName: 'video-a' }]);
    expect(f.calls[0].body).toEqual({ tracks: [{ location: 'remote', sessionId: 'sess-a', trackName: 'video-a' }] });
  });

  it('renegotiates with the browser answer (PUT)', async () => {
    const f = makeFetch({ status: 200, json: {} });
    await make(f).renegotiate('sess-b', 'ANSWER');
    expect(f.calls[0].url).toBe(`${BASE}/apps/APP/sessions/sess-b/renegotiate`);
    expect(f.calls[0].init.method).toBe('PUT');
    expect(f.calls[0].body).toEqual({ sessionDescription: { type: 'answer', sdp: 'ANSWER' } });
  });

  it('force-closes tracks by mid with no renegotiation by default (PUT)', async () => {
    const f = makeFetch({ status: 200, json: {} });
    await make(f).closeTracks('sess-a', { mids: ['0', '1'] });
    expect(f.calls[0].url).toBe(`${BASE}/apps/APP/sessions/sess-a/tracks/close`);
    expect(f.calls[0].init.method).toBe('PUT');
    expect(f.calls[0].body).toEqual({ tracks: [{ mid: '0' }, { mid: '1' }], force: true });
  });

  it('can still close with a renegotiation offer when one is supplied', async () => {
    const f = makeFetch({ status: 200, json: {} });
    await make(f).closeTracks('sess-a', { mids: ['0'], sdp: 'OFFER2' });
    expect(f.calls[0].body).toEqual({ tracks: [{ mid: '0' }], sessionDescription: { type: 'offer', sdp: 'OFFER2' }, force: false });
  });

  it('turns a non-2xx response into a CloudflareError that never contains the secret', async () => {
    const f = makeFetch({ status: 401, json: { errorDescription: 'bad token' } });
    const err = await make(f).newSession().catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareError);
    expect(err.status).toBe(401);
    expect(err.message).toContain('401');
    expect(err.message).toContain('bad token');
    expect(err.message).not.toContain('SECRET');
  });

  it('wraps network failures', async () => {
    const f = async () => {
      throw new Error('socket hang up');
    };
    await expect(make(f).newSession()).rejects.toThrow(/socket hang up/);
  });

  it('generates TURN ICE servers with the TURN key token and caches them', async () => {
    const servers = [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }];
    const f = makeFetch({ status: 201, json: { iceServers: servers } });
    const client = make(f);
    await expect(client.getIceServers()).resolves.toEqual(servers);
    await expect(client.getIceServers()).resolves.toEqual(servers);
    expect(f.calls).toHaveLength(1); // second call served from cache
    expect(f.calls[0].url).toBe(`${BASE}/turn/keys/KEY/credentials/generate-ice-servers`);
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer TURNTOKEN');
    expect(f.calls[0].body).toEqual({ ttl: 86400 });
  });

  it('falls back to STUN only when no TURN key is configured, without calling out', async () => {
    const f = makeFetch();
    const client = createCloudflareClient({ appId: 'a', appSecret: 'b', fetchImpl: f });
    await expect(client.getIceServers()).resolves.toEqual(FALLBACK_ICE_SERVERS);
    expect(f.calls).toHaveLength(0);
  });
});
