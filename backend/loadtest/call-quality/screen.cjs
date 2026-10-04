// Live check with a REAL getDisplayMedia track (current-tab capture), static page, camera on first.
const fs = require('fs'); const http = require('http'); const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, registry, server } = require('./cf-server.cjs');
(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body style="background:#246"><h1>static screen</h1></body></html>'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${web.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--no-sandbox'] });
  const bundle = fs.readFileSync(`${__dirname}/bundle.js`, 'utf8');
  const config = { iceServers: await cf.getIceServers(), limits: { maxVideoHeight: 720, maxVideoBitrate: 1500000, maxScreenBitrate: 2500000, maxAudioBitrate: 48000 } };
  const open = async (id) => {
    const page = await (await browser.newContext({ permissions: ['camera', 'microphone'] })).newPage();
    page.on('pageerror', (e) => console.log(`[${id} pageerror]`, e.message));
    page.on('console', (m) => /fail|error/i.test(m.text()) && console.log(`[${id}]`, m.text()));
    await page.exposeFunction('cfRequest', async (event, payload) => { try { return { ok: await server(id, event, payload) }; } catch (e) { return { err: e.message }; } });
    await page.goto(url); await page.addScriptTag({ content: bundle });
    await page.evaluate((cid) => { window.__redux.io.io = { id: cid, request: async (e, p) => { const r = await window.cfRequest(e, p); if (r.err) throw new Error(r.err); return r.ok; } }; }, id);
    await page.evaluate(async (config) => { await window.__engine.start({ roomID: 'r', config }); }, config);
    return page;
  };
  const A = await open('A'); const B = await open('B');
  const out = {};
  out.publish = await A.evaluate(async () => {
    const r = {};
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      await window.__engine.produce('video', cam); r.camera = 'ok';
      const scr = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true });
      const t = scr.getVideoTracks()[0]; r.screenTrack = `${t.label} ${JSON.stringify({ w: t.getSettings().width, h: t.getSettings().height })} hint=${t.contentHint}`;
      await window.__engine.produce('screen', scr, { isScreen: true }); r.screen = 'ok';
    } catch (e) { r.error = e.name + ': ' + e.message; }
    return r;
  });
  const ids = Object.keys(registry);
  const snap = ids.map((id) => ({ producerID: id, roomID: 'r', socketID: 'A', userID: 'a', kind: registry[id].kind, isScreen: !!registry[id].isScreen }));
  out.registry = snap.map((p) => `${p.kind}${p.isScreen ? '(screen)' : ''}`);
  out.subscriber = await B.evaluate(async (producers) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__redux.rtc.producers = producers; window.__engine.onProducersChanged();
    const t0 = Date.now(); while (Date.now() - t0 < 15000 && window.__g.streams.length < producers.length) await wait(200);
    await wait(4000);
    const stats = await window.__clientPCs[1].getStats(); const rows = [];
    stats.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') rows.push(`${s.frameWidth}x${s.frameHeight} decoded=${s.framesDecoded}`); });
    return { got: window.__g.streams.length, tracks: window.__g.streams.map((s) => { const t = (s.isVideo ? s.getVideoTracks() : s.getAudioTracks())[0]; return `${t.kind}:${t.muted ? 'MUTED' : 'ok'}`; }), inboundVideo: rows };
  }, snap);
  console.log(JSON.stringify(out, null, 2));
  await browser.close(); web.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
