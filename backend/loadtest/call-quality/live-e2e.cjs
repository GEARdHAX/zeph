// Live end-to-end check against REAL Cloudflare Realtime: client A publishes audio+video, client B
// subscribes (media must actually flow), A closes its camera and republishes, B receives the new
// video. Prints one JSON object. Usage: see README.md.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, sessions, registry, log, server } = require('./cf-server.cjs');

(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><html><body>live</body></html>'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${web.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const bundle = fs.readFileSync(`${__dirname}/bundle.js`, 'utf8');
  const iceServers = await cf.getIceServers();
  const config = { iceServers, limits: { maxVideoHeight: 360, maxVideoBitrate: 600000, maxScreenBitrate: 1500000, maxAudioBitrate: 40000 } };
  const open = async (id) => {
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[${id} pageerror]`, e.message));
    await page.exposeFunction('cfRequest', async (event, payload) => {
      try { return { ok: await server(id, event, payload) }; } catch (e) { return { err: e.message }; }
    });
    await page.goto(url);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((cid) => {
      window.__redux.io.io = { id: cid, request: async (event, payload) => { const r = await window.cfRequest(event, payload); if (r.err) throw new Error(r.err); return r.ok; } };
    }, id);
    return page;
  };
  const A = await open('A'); const B = await open('B');
  const out = {};
  out.publisher = await A.evaluate(async (config) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    await window.__engine.start({ roomID: 'live-room', config });
    await window.__engine.produce('audio', mic);
    await window.__engine.produce('video', cam);
    return { connection: window.__clientPCs[0].connectionState, iceState: window.__clientPCs[0].iceConnectionState };
  }, config);
  const ids = Object.keys(registry);
  out.publishedProducers = ids.map((id) => `${registry[id].kind}`);
  out.subscriber = await B.evaluate(async ({ config, ids, kinds }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__engine.start({ roomID: 'live-room', config });
    window.__redux.rtc.producers = ids.map((producerID, i) => ({ producerID, roomID: 'live-room', socketID: 'A', userID: 'a', kind: kinds[i] }));
    window.__engine.onProducersChanged();
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && window.__g.streams.length < 2) await wait(200);
    const streams = window.__g.streams;
    const res = { streams: streams.map((s) => ({ isVideo: s.isVideo, producerID: s.producerID.slice(0, 8) + '...' })), connection: window.__clientPCs[0].connectionState + '/' + window.__clientPCs[1].connectionState };
    // media actually flowing = tracks unmuted
    const t1 = Date.now();
    const tracks = streams.map((s) => (s.isVideo ? s.getVideoTracks()[0] : s.getAudioTracks()[0]));
    while (Date.now() - t1 < 15000 && tracks.some((t) => t.muted)) await wait(200);
    res.mediaFlowing = tracks.map((t) => `${t.kind}:${t.muted ? 'MUTED' : 'flowing'}`);
    return res;
  }, { config, ids, kinds: ids.map((id) => registry[id].kind) });
  out.close = await A.evaluate(async () => { try { await window.__engine.unpublish('video'); return 'ok'; } catch (e) { return 'ERR ' + e.message; } });
  out.republish = await A.evaluate(async () => {
    try {
      const cam2 = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
      await window.__engine.produce('video', cam2);
      return { ok: true, connection: window.__clientPCs[0].connectionState, signaling: window.__clientPCs[0].signalingState };
    } catch (e) { return 'ERR ' + e.message; }
  });
  const newIds = Object.keys(registry).filter((id) => !ids.includes(id));
  out.subscriberAfter = await B.evaluate(async ({ ids, newIds }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__redux.rtc.producers = [{ producerID: ids[0], roomID: 'live-room', socketID: 'A', userID: 'a', kind: 'audio' }, { producerID: newIds[0], roomID: 'live-room', socketID: 'A', userID: 'a', kind: 'video' }];
    window.__engine.onProducersChanged();
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && window.__g.streams.length < 3) await wait(200);
    const fresh = window.__g.streams.find((x) => x.producerID === newIds[0]);
    const audio = window.__g.streams.find((x) => x.producerID === ids[0]);
    const track = fresh && fresh.getVideoTracks()[0];
    const t1 = Date.now();
    while (track && Date.now() - t1 < 15000 && track.muted) await wait(200);
    return { gotNewVideo: !!fresh, newVideoFlowing: !!track && !track.muted, audioStillLive: !!audio && audio.getAudioTracks()[0].readyState === 'live' && !audio.getAudioTracks()[0].muted };
  }, { ids, newIds });
  out.serverCalls = log.join(' ');
  console.log(JSON.stringify(out, null, 2));
  await browser.close(); web.close();
})().catch((e) => { console.error('LIVE TEST FAILED:', e.message); process.exit(1); });
