// Live video-quality measurement against REAL Cloudflare Realtime: publishes a camera captured the
// way the Meeting UI does ({ video: true }) for ~13s per setting and reads WebRTC getStats() on the
// publisher (outbound-rtp) and the subscriber (inbound-rtp). Prints a JSON array.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../frontend/node_modules/playwright'));
const { cf, sessions, registry, log, server } = require('./cf-server.cjs');

(async () => {
  const web = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><html><body>q</body></html>'); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${web.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const bundle = fs.readFileSync(`${__dirname}/bundle.js`, 'utf8');
  const iceServers = await cf.getIceServers();
  const runCase = async (label, limits) => {
    for (const k of Object.keys(sessions)) delete sessions[k];
    for (const k of Object.keys(registry)) delete registry[k];
    const config = { iceServers, limits };
    const open = async (id) => {
      const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
      const page = await ctx.newPage();
      await page.exposeFunction('cfRequest', async (event, payload) => { try { return { ok: await server(id, event, payload) }; } catch (e) { return { err: e.message }; } });
      await page.goto(url); await page.addScriptTag({ content: bundle });
      await page.evaluate((cid) => { window.__redux.io.io = { id: cid, request: async (e, p) => { const r = await window.cfRequest(e, p); if (r.err) throw new Error(r.err); return r.ok; } }; }, id);
      return page;
    };
    const A = await open('A'); const B = await open('B');
    const sent = await A.evaluate(async (config) => {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true }); // exactly what the Meeting UI asks for
      window.__capture = cam.getVideoTracks()[0].getSettings();
      await window.__engine.start({ roomID: 'q', config });
      await window.__engine.produce('video', cam);
      return { capturedByUI: `${window.__capture.width}x${window.__capture.height}` };
    }, config);
    const ids = Object.keys(registry);
    await B.evaluate(async ({ config, ids }) => {
      await window.__engine.start({ roomID: 'q', config });
      window.__redux.rtc.producers = ids.map((producerID) => ({ producerID, roomID: 'q', socketID: 'A', userID: 'a', kind: 'video' }));
      window.__engine.onProducersChanged();
      const t0 = Date.now(); while (Date.now() - t0 < 15000 && window.__g.streams.length < 1) await new Promise((r) => setTimeout(r, 200));
    }, { config, ids });
    await new Promise((r) => setTimeout(r, 8000)); // let bandwidth estimation ramp
    const snap = async (page, type) => page.evaluate(async (type) => {
      const pc = window.__clientPCs[type === 'outbound-rtp' ? 0 : 1]; const rep = await pc.getStats(); let o = null;
      rep.forEach((x) => { if (x.type === type && x.kind === 'video') o = { w: x.frameWidth, h: x.frameHeight, fps: Math.round(x.framesPerSecond || 0), bytes: x.bytesSent ?? x.bytesReceived, limit: x.qualityLimitationReason, t: x.timestamp }; });
      return o;
    }, type);
    const a1 = await snap(A, 'outbound-rtp'); const b1 = await snap(B, 'inbound-rtp');
    await new Promise((r) => setTimeout(r, 5000));
    const a2 = await snap(A, 'outbound-rtp'); const b2 = await snap(B, 'inbound-rtp');
    const kbps = (x, y) => Math.round(((y.bytes - x.bytes) * 8) / (y.t - x.t));
    await A.context().close(); await B.context().close();
    return { label, ...sent, sentByEngine: `${a2.w}x${a2.h}@${a2.fps}fps ${kbps(a1, a2)}kbps (limited by: ${a2.limit})`, subscriberReceives: `${b2.w}x${b2.h}@${b2.fps}fps ${kbps(b1, b2)}kbps` };
  };
  const out = [];
  out.push(await runCase('OLD caps  360p / 600 kbps', { maxVideoHeight: 360, maxVideoBitrate: 600000, maxScreenBitrate: 1500000, maxAudioBitrate: 40000 }));
  out.push(await runCase('NEW caps  720p / 1.5 Mbps', { maxVideoHeight: 720, maxVideoBitrate: 1500000, maxScreenBitrate: 2500000, maxAudioBitrate: 48000 }));
  console.log(JSON.stringify(out, null, 2));
  await browser.close(); web.close();
})().catch((e) => { console.error('QUALITY TEST FAILED:', e.message); process.exit(1); });
