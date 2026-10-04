// A shares camera+screen first; B pulls them, THEN B publishes camera+screen; A and C pull B's.
const fs = require('fs'); const http = require('http'); const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, registry, server } = require('./cf-server.cjs');
(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body style="background:#264"><h1>screen</h1></body></html>'); });
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
  const [A, B, C] = await Promise.all(['A', 'B', 'C'].map(open));
  const snap = () => Object.keys(registry).map((p) => ({ producerID: p, roomID: 'r', socketID: registry[p].socketID, userID: registry[p].socketID, kind: registry[p].kind, isScreen: !!registry[p].isScreen }));
  const publishAll = (P) => P.evaluate(async () => {
    const r = {};
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      await window.__engine.produce('audio', mic); await window.__engine.produce('video', cam);
      const scr = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true });
      await window.__engine.produce('screen', scr, { isScreen: true }); r.ok = true;
    } catch (e) { r.err = e.message; }
    return r;
  });
  const sync = (P, who) => P.evaluate(async (pr) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__redux.rtc.producers = pr; window.__engine.onProducersChanged();
    const want = pr.filter((p) => p.socketID !== window.__redux.io.io.id).length;
    const t0 = Date.now(); while (Date.now() - t0 < 20000 && window.__g.streams.length < want) await wait(200);
    await wait(3000);
    const st = await window.__clientPCs[1].getStats(); const dec = [];
    st.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') dec.push(s.framesDecoded); });
    return { want, got: window.__g.streams.length, videoFramesDecoded: dec };
  }, snap());
  const out = {};
  out.A_publish = await publishAll(A);
  out.B_pullsA = await sync(B);
  out.B_publish = await publishAll(B);
  out.A_pullsB = await sync(A);
  out.C_pullsAll = await sync(C);
  out.B_pullsAgain = await sync(B);
  console.log(JSON.stringify(out));
  await browser.close(); web.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
