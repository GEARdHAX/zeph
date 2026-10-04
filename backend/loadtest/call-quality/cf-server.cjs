// Node-side stand-in for backend/src/calls/cloudflare's socket handlers: same Cloudflare
// calls (through the real backend client), no database or auth. Credentials come from
// backend/.env and are never printed.
const path = require('path');

require(path.resolve(__dirname, '../../node_modules/dotenv')).config({ path: path.resolve(__dirname, '../../.env') });
const { createCloudflareClient } = require('../../src/calls/cloudflare/client');

const env = process.env;
const cf = createCloudflareClient({
  appId: env.CF_REALTIME_APP_ID,
  appSecret: env.CF_REALTIME_APP_SECRET,
  turnKeyId: env.CF_TURN_KEY_ID,
  turnApiToken: env.CF_TURN_API_TOKEN,
});

const sessions = {}; const pullSessions = {}; const registry = {}; const log = [];
const server = async (client, event, p) => {
  log.push(`${client}:${event}`);
  if (event === 'cf:session:new') { sessions[client] = await cf.newSession(); pullSessions[client] = await cf.newSession(); return { sessionId: sessions[client], pullSessionId: pullSessions[client] }; }
  if (event === 'cf:tracks:push') {
    const out = await cf.pushTracks(sessions[client], { sdp: p.sessionDescription, tracks: p.tracks });
    const bad = (out.tracks || []).filter((t) => t.errorCode);
    if (bad.length) throw new Error('push track error: ' + JSON.stringify(bad.map((b) => [b.errorCode, b.errorDescription])));
    const ids = p.tracks.map((t) => `${sessions[client]}/${t.trackName}`);
    p.tracks.forEach((t, i) => { registry[ids[i]] = { sessionId: sessions[client], trackName: t.trackName, kind: t.kind, isScreen: t.isScreen === true, socketID: client }; });
    return { sessionDescription: out.sessionDescription.sdp, producerIDs: ids, rejected: [] };
  }
  if (event === 'cf:tracks:ready') return { announced: p.producerIDs.length };
  if (event === 'cf:tracks:pull') {
    const recs = p.producerIDs.map((id) => registry[id]);
    const out = await cf.pullTracks(pullSessions[client], recs.map((r) => ({ sessionId: r.sessionId, trackName: r.trackName })));
    const errs = (out.tracks || []).filter((t) => t.errorCode);
    if (errs.length) throw new Error('pull track error: ' + JSON.stringify(errs.map((b) => [b.errorCode, b.errorDescription])));
    return { sessionDescription: out.sessionDescription && out.sessionDescription.sdp, requiresImmediateRenegotiation: !!out.requiresImmediateRenegotiation,
      tracks: out.tracks.map((t) => ({ mid: t.mid, producerID: `${t.sessionId}/${t.trackName}`, socketID: registry[`${t.sessionId}/${t.trackName}`].socketID, kind: registry[`${t.sessionId}/${t.trackName}`].kind })) };
  }
  if (event === 'cf:renegotiate') { await cf.renegotiate(pullSessions[client], p.sessionDescription); return { ok: true }; }
  if (event === 'cf:tracks:close') {
    await cf.closeTracks(sessions[client], { mids: p.closes.map((c) => c.mid) });
    p.closes.forEach((c) => delete registry[c.producerID]);
    return { ok: true };
  }
  throw new Error('unexpected ' + event);
};


module.exports = { cf, sessions, registry, log, server };
