// Live: A turns mic / camera / screen share OFF and ON repeatedly while B receives. After every
// cycle B must get a NEW stream whose media really flows (bytes increase). Prints one line per cycle.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, registry, server } = require('./cf-server.cjs');

const CYCLES = Number(process.env.CYCLES || 3);

(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<html><body style="background:#246"><h1>screen</h1></body></html>'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${web.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--no-sandbox'] });
  const bundle = fs.readFileSync(`${__dirname}/bundle.js`, 'utf8');
  const config = { iceServers: await cf.getIceServers(), limits: { maxVideoHeight: 720, maxVideoBitrate: 1500000, maxScreenBitrate: 2500000, maxAudioBitrate: 48000 } };
  const open = async (id) => {
    const page = await (await browser.newContext({ permissions: ['camera', 'microphone'] })).newPage();
    page.on('pageerror', (e) => console.log(`[${id} pageerror]`, e.message));
    page.on('console', (m) => /fail|error|reject/i.test(m.text()) && console.log(`[${id}]`, m.text().slice(0, 200)));
    await page.exposeFunction('cfRequest', async (event, payload) => { try { return { ok: await server(id, event, payload) }; } catch (e) { return { err: e.message }; } });
    await page.goto(url); await page.addScriptTag({ content: bundle });
    await page.evaluate((cid) => { window.__redux.io.io = { id: cid, request: async (e, p) => { const r = await window.cfRequest(e, p); if (r.err) throw new Error(r.err); return r.ok; } }; }, id);
    await page.evaluate(async (config) => { await window.__engine.start({ roomID: 'r', config }); }, config);
    return page;
  };
  const A = await open('A'); const B = await open('B');
  const snap = () => Object.keys(registry).map((p) => ({ producerID: p, roomID: 'r', socketID: registry[p].socketID, userID: 'a', kind: registry[p].kind, isScreen: !!registry[p].isScreen }));

  const publish = (slot) => A.evaluate(async (slot) => {
    const t0 = performance.now();
    try {
      const media = slot === 'audio' ? await navigator.mediaDevices.getUserMedia({ audio: true })
        : slot === 'video' ? await navigator.mediaDevices.getUserMedia({ video: true })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true });
      await window.__engine.produce(slot, media, { isScreen: slot === 'screen' });
      window.__tracks = window.__tracks || {}; window.__tracks[slot] = media; return 'ok ' + Math.round(performance.now() - t0) + 'ms';
    } catch (e) { return 'ERR ' + e.message; }
  }, slot);
  const stop = async (slot) => {
    const r = await A.evaluate(async (slot) => {
      try { (window.__tracks[slot].getTracks()).forEach((t) => t.stop()); await window.__engine.unpublish(slot); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
    }, slot);
    // what the real 'remove' socket event does: drop the closed producer from the receiver's list
    await B.evaluate((producers) => { window.__redux.rtc.producers = producers; }, snap());
    return r;
  };
  // B pulls whatever is live, then checks the newest stream of that kind carries bytes.
  const receive = (kind) => B.evaluate(async ({ producers, kind }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const before = window.__g.streams.length;
    const r0 = performance.now();
    window.__redux.rtc.producers = producers; window.__engine.onProducersChanged();
    const t0 = Date.now(); while (Date.now() - t0 < 15000 && window.__g.streams.length <= before) await wait(200);
    if (window.__g.streams.length <= before) return 'NO NEW STREAM';
    const streamMs = Math.round(performance.now() - r0);
    const s = window.__g.streams[window.__g.streams.length - 1];
    const track = (s.isVideo ? s.getVideoTracks() : s.getAudioTracks())[0];
    const bytes = async () => { let n = 0; for (const pc of window.__clientPCs) { const st = await pc.getStats(); st.forEach((x) => { if (x.type === 'inbound-rtp' && x.trackIdentifier === track.id) n = x.bytesReceived || 0; }); } return n; };
    await wait(1500); const b1 = await bytes(); await wait(1500); const b2 = await bytes();
    return `stream after ${streamMs}ms, ${b2 > b1 ? 'FLOWING' : 'STALLED'}`;
  }, { producers: snap(), kind });

  for (const slot of ['audio', 'video', 'screen']) {
    for (let i = 1; i <= CYCLES; i += 1) {
      const p = await publish(slot);
      const r = p.startsWith('ok') ? await receive(slot) : 'n/a';
      console.log(`${slot.padEnd(6)} on  #${i}: publish ${p}; receiver ${r}`);
      const s = await stop(slot);
      if (s !== 'ok') console.log(`${slot.padEnd(6)} off #${i}: ${s}`);
    }
  }
  await browser.close(); web.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
