// Live: N participants each publish audio+camera+screen CONCURRENTLY while everyone pulls everyone.
const fs = require('fs'); const http = require('http'); const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, registry, server } = require('./cf-server.cjs');
const N = Number(process.env.N || 3);
(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body>x</body></html>'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${web.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const bundle = fs.readFileSync(`${__dirname}/bundle.js`, 'utf8');
  const config = { iceServers: await cf.getIceServers(), limits: { maxVideoHeight: 720, maxVideoBitrate: 1500000, maxScreenBitrate: 2500000, maxAudioBitrate: 48000 } };
  const owners = {};
  const open = async (id) => {
    const page = await (await browser.newContext({ permissions: ['camera', 'microphone'] })).newPage();
    page.on('pageerror', (e) => console.log(`[${id} pageerror]`, e.message));
    page.on('console', (m) => /fail|error/i.test(m.text()) && console.log(`[${id}]`, m.text()));
    await page.exposeFunction('cfRequest', async (event, payload) => {
      const before = new Set(Object.keys(registry));
      try { const ok = await server(id, event, payload); Object.keys(registry).filter((i) => !before.has(i)).forEach((i) => { owners[i] = id; }); return { ok }; } catch (e) { return { err: e.message }; }
    });
    await page.goto(url); await page.addScriptTag({ content: bundle });
    await page.evaluate((cid) => { window.__redux.io.io = { id: cid, request: async (e, p) => { const r = await window.cfRequest(e, p); if (r.err) throw new Error(r.err); return r.ok; } }; }, id);
    await page.evaluate(async (config) => { await window.__engine.start({ roomID: 'r', config }); }, config);
    return page;
  };
  const ids = Array.from({ length: N }, (_, i) => `P${i}`);
  const pages = await Promise.all(ids.map(open));
  const snapshot = () => Object.keys(registry).map((p) => ({ producerID: p, roomID: 'r', socketID: registry[p].socketID, userID: registry[p].socketID, kind: registry[p].kind, isScreen: !!registry[p].isScreen }));
  // keep syncing producers into every page while publishing (like newProducer events do)
  let stop = false;
  const syncLoop = (P) => (async () => { while (!stop) { await P.evaluate((pr) => { window.__redux.rtc.producers = pr; window.__engine.onProducersChanged(); }, snapshot()); await new Promise((r) => setTimeout(r, 400)); } })();
  const loops = pages.map(syncLoop);
  const res = await Promise.all(pages.map((P) => P.evaluate(async () => {
    const r = {};
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    const scr = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const [slot, st, o] of [['audio', mic, {}], ['video', cam, {}], ['screen', scr, { isScreen: true }]]) {
      try { await window.__engine.produce(slot, st, o); r[slot] = 'ok'; } catch (e) { r[slot] = 'ERR ' + e.message; }
    }
    return r;
  })));
  await new Promise((r) => setTimeout(r, 12000));
  stop = true; await Promise.all(loops);
  const out = { publish: res, totalProducers: Object.keys(registry).length };
  out.receive = await Promise.all(pages.map((P, i) => P.evaluate(async (want) => {
    const t = window.__g.streams.map((s) => (s.isVideo ? s.getVideoTracks()[0] : s.getAudioTracks()[0]));
    return { got: window.__g.streams.length, want, muted: t.filter((x) => x.muted).length, bySocket: [...new Set(window.__g.streams.map((s) => s.socketID))].length, pc: window.__clientPCs[0].connectionState + '/' + window.__clientPCs[1].connectionState };
  }, 3 * (N - 1))));
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); web.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
