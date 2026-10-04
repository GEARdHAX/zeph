// Live check: A publishes audio + camera + screen, B subscribes to all three at once and one by one.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, registry, server } = require('./cf-server.cjs');

(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><html><body>x</body></html>'); });
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
    return page;
  };
  const A = await open('A'); const B = await open('B');
  const out = {};
  out.publish = await A.evaluate(async (config) => {
    const res = {};
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const scr = await navigator.mediaDevices.getUserMedia({ video: true });
    await window.__engine.start({ roomID: 'r', config });
    for (const [slot, st, o] of [['audio', mic, {}], ['video', cam, {}], ['screen', scr, { isScreen: true }]]) {
      try { await window.__engine.produce(slot, st, o); res[slot] = 'ok'; } catch (e) { res[slot] = 'ERR ' + e.message; }
    }
    return res;
  }, config);
  const ids = Object.keys(registry);
  out.registry = ids.map((id) => `${registry[id].kind}${registry[id].isScreen ? '(screen)' : ''}`);
  out.subscriber = await B.evaluate(async ({ config, ids, kinds }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__engine.start({ roomID: 'r', config });
    window.__redux.rtc.producers = ids.map((producerID, i) => ({ producerID, roomID: 'r', socketID: 'A', userID: 'a', kind: kinds[i] }));
    window.__engine.onProducersChanged();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && window.__g.streams.length < ids.length) await wait(200);
    const tracks = window.__g.streams.map((s) => (s.isVideo ? s.getVideoTracks()[0] : s.getAudioTracks()[0]));
    const t1 = Date.now();
    while (Date.now() - t1 < 15000 && tracks.some((t) => t.muted)) await wait(200);
    return { got: window.__g.streams.length, of: ids.length, media: tracks.map((t) => `${t.kind}:${t.muted ? 'MUTED' : 'flowing'}`) };
  }, { config, ids, kinds: ids.map((id) => registry[id].kind) });
  console.log(JSON.stringify(out, null, 2));
  await browser.close(); web.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
