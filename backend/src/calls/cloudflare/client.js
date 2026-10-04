// Thin client for Cloudflare Realtime (SFU + TURN). Everything is plain HTTPS,
// so unlike mediasoup this runs on any host (Render included) — no native
// module, no open UDP port range.
//
//   SFU   https://rtc.live.cloudflare.com/v1/apps/{appId}/sessions/...   (Bearer app secret)
//   TURN  https://rtc.live.cloudflare.com/v1/turn/keys/{keyId}/...       (Bearer TURN key token)
//
// A Cloudflare "session" is one WebRTC PeerConnection. Tracks are published
// ("local") and subscribed ("remote") by name; there is no room concept, so
// rooms/authorization stay in Zeph (see ./index.js). Secrets never leave this
// module: error messages carry the HTTP status and Cloudflare's own message
// but never request headers.
const API_BASE = 'https://rtc.live.cloudflare.com/v1';
const REQUEST_TIMEOUT_MS = 10000;
const TURN_TTL_SECONDS = 86400;
// Credentials are valid for TURN_TTL_SECONDS; refresh well before so a call
// that starts right before expiry still has hours left.
const TURN_CACHE_MS = 6 * 60 * 60 * 1000;
const FALLBACK_ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

class CloudflareError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.body = body;
  }
}

const createCloudflareClient = ({ appId, appSecret, turnKeyId, turnApiToken, fetchImpl = globalThis.fetch } = {}) => {
  const isConfigured = () => !!(appId && appSecret);
  const turnConfigured = () => !!(turnKeyId && turnApiToken);

  const request = async (method, url, token, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        // Content-Type only when there is a body: Cloudflare validates an empty `{}` as a
        // (malformed) sessionDescription, so bodiless calls must be truly bodiless.
        headers: body === undefined ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new CloudflareError(err.name === 'AbortError' ? 'Cloudflare request timed out' : `Cloudflare request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      /* empty or non-JSON body */
    }
    if (!res.ok) {
      const detail = (json && (json.errorDescription || json.message || json.error)) || res.statusText || 'error';
      throw new CloudflareError(`Cloudflare ${method} ${url.replace(API_BASE, '')} -> ${res.status}: ${detail}`, {
        status: res.status,
        body: json,
      });
    }
    return json || {};
  };

  const sfu = (method, path, body) => request(method, `${API_BASE}/apps/${appId}${path}`, appSecret, body);

  const newSession = async () => {
    const out = await sfu('POST', '/sessions/new');
    if (!out.sessionId) throw new CloudflareError('Cloudflare did not return a sessionId');
    return out.sessionId;
  };

  // Publish: the browser's offer + one entry per transceiver ({ mid, trackName }).
  const pushTracks = (sessionId, { sdp, tracks }) =>
    sfu('POST', `/sessions/${sessionId}/tracks/new`, {
      sessionDescription: { type: 'offer', sdp },
      tracks: tracks.map(({ mid, trackName }) => ({ location: 'local', mid, trackName })),
    });

  // Subscribe: remote tracks identified by publisher session + track name.
  // Cloudflare answers with an OFFER the browser must answer (renegotiate).
  const pullTracks = (sessionId, remoteTracks) =>
    sfu('POST', `/sessions/${sessionId}/tracks/new`, {
      tracks: remoteTracks.map(({ sessionId: remoteSession, trackName }) => ({
        location: 'remote',
        sessionId: remoteSession,
        trackName,
      })),
    });

  const renegotiate = (sessionId, sdp) =>
    sfu('PUT', `/sessions/${sessionId}/renegotiate`, { sessionDescription: { type: 'answer', sdp } });

  // Close tracks by mid. Without an offer this is a forced close with no renegotiation:
  // verified live that renegotiating a close with an inactive-transceiver offer makes
  // Cloudflare's answer reassign an RTP header-extension ID, which Chrome rejects
  // ("RTP extension ID reassignment not supported"). The browser then just stops the
  // transceiver locally. Pass `sdp` to use Cloudflare's renegotiated-close flow instead.
  const closeTracks = (sessionId, { mids, sdp = null, force = !sdp }) =>
    sfu('PUT', `/sessions/${sessionId}/tracks/close`, {
      tracks: mids.map((mid) => ({ mid })),
      ...(sdp ? { sessionDescription: { type: 'offer', sdp } } : {}),
      force,
    });

  let iceCache = null;
  const getIceServers = async () => {
    if (!turnConfigured()) return FALLBACK_ICE_SERVERS;
    if (iceCache && iceCache.expires > Date.now()) return iceCache.servers;
    const out = await request(
      'POST',
      `${API_BASE}/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
      turnApiToken,
      { ttl: TURN_TTL_SECONDS },
    );
    const servers = Array.isArray(out.iceServers) && out.iceServers.length ? out.iceServers : FALLBACK_ICE_SERVERS;
    iceCache = { servers, expires: Date.now() + TURN_CACHE_MS };
    return servers;
  };

  return { isConfigured, turnConfigured, newSession, pushTracks, pullTracks, renegotiate, closeTracks, getIceServers };
};

module.exports = { createCloudflareClient, CloudflareError, FALLBACK_ICE_SERVERS };
