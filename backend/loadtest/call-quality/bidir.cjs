// Live check: A and B both publish and pull on the same PC; camera + screen are started AFTER receiving.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, registry, server } = require('./cf-server.cjs');

(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body>x</body></html>'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${web.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const bundle = fs.readFileSync(`${__dirname}/bundle.js`, 'utf8');
  const config = { iceServers: await cf.getIceServers(), limits: { maxVideoHeight: 720, maxVideoBitrate: 1500000, maxScreenBitrate: 2500000, maxAudioBitrate: 48000 } };
  const open = async (id) => {
    const page = await (await browser.newContext({ permissions: ['camera', 'microphone'] })).newPage();
    page.on('pageerror', (e) => console.log(`[${id} pageerror]`, e.message));
    page.on('console', (m) => /fail|error/i.test(m.text()) && console.log(`[${id}]`, m.text()));
    await page.exposeFunction('cfRequest', async (event, payload) => { try { return { ok: await server(id, event, payload) }; } catch (e) { return { err: e.message }; } });
    await page.goto(url);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((cid) => { window.__redux.io.io = { id: cid, request: async (e, p) => { const r = await window.cfRequest(e, p); if (r.err) throw new Error(r.err); return r.ok; } }; }, id);
    await page.evaluate(async (config) => { await window.__engine.start({ roomID: 'r', config }); }, config);
    return page;
  };
  const A = await open('A'); const B = await open('B');
  const pub = (P, slot, opts = {}) => P.evaluate(async ({ slot, opts }) => {
    try {
      const st = await navigator.mediaDevices.getUserMedia(slot === 'audio' ? { audio: true } : { video: true });
      await window.__engine.produce(slot, st, opts); return 'ok';
    } catch (e) { return 'ERR ' + e.message; }
  }, { slot, opts });
  const sync = (P) => P.evaluate(async (producers) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__redux.rtc.producers = producers;
    window.__engine.onProducersChanged();
    const want = producers.filter((p) => p.socketID !== window.__redux.io.io.id).length;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && window.__g.streams.length < want) await wait(200);
    const tr = window.__g.streams.map((s) => (s.isVideo ? s.getVideoTracks()[0] : s.getAudioTracks()[0]));
    const t1 = Date.now();
    while (Date.now() - t1 < 12000 && tr.some((t) => t.muted)) await wait(200);
    return { got: window.__g.streams.length, want, media: tr.map((t) => `${t.kind}:${t.muted ? 'MUTED' : 'ok'}`) };
  }, snapshot());
  const owners = {};
  const snapshot = () => Object.keys(registry).map((id) => ({ producerID: id, roomID: 'r', socketID: owners[id], userID: owners[id], kind: registry[id].kind, isScreen: !!registry[id].isScreen }));
  const track = async (P, who, slot, opts) => { const before = new Set(Object.keys(registry)); const r = await pub(P, slot, opts); Object.keys(registry).filter((i) => !before.has(i)).forEach((i) => { owners[i] = who; }); return r; };
  const out = {};
  out.A_audio = await track(A, 'A', 'audio');
  out.B_audio = await track(B, 'B', 'audio');
  out.A_pullsB = await sync(A, 'B');
  out.B_pullsA = await sync(B, 'A');
  out.A_video_late = await track(A, 'A', 'video');
  out.A_screen_late = await track(A, 'A', 'screen', { isScreen: true });
  out.B_pullsA_again = await sync(B, 'A');
  out.B_video_late = await track(B, 'B', 'video');
  out.A_pullsB_again = await sync(A, 'B');
  console.log(JSON.stringify(out, null, 2));
  await browser.close(); web.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
