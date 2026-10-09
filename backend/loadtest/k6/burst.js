// Grafana k6 version of the burst load tests: VUS virtual users each fire ONE request at the same moment
// (per-vu-iterations, 1 iteration), the same pattern as the Node scripts in ../.
//
//   SCENARIO=messages|rooms|login|upload|socket   VUS=100   [RATE=200 DURATION=15s for a steady arrival rate]   BASE=http://127.0.0.1:4099
//   USERS=<users.json from seed.js>   ROOMS=<rooms.json from seed-rooms.js>   PNG=<path to a png>   (see ./README.md)
//
// Run only against a LOCAL throwaway backend. Raise the RATE_LIMIT_* capacities on the target to measure raw capacity,
// otherwise the rate limiter (correctly) rejects most of the burst.
import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import exec from 'k6/execution';

const VUS = Number(__ENV.VUS || 100);
const BASE = __ENV.BASE || 'http://127.0.0.1:4099';
const SCENARIO = __ENV.SCENARIO || 'messages';

const users = __ENV.USERS ? JSON.parse(open(__ENV.USERS)) : null;
const rooms = __ENV.ROOMS ? JSON.parse(open(__ENV.ROOMS)).rooms : null;
const png = __ENV.PNG ? open(__ENV.PNG, 'b') : null;

const socketAuthMs = new Trend('socket_connect_auth_ms', true);
const socketOk = new Counter('socket_authenticated');

// RATE=<requests per second> switches from a one-shot burst to a steady arrival rate for DURATION (default 15s) over
// reusable keep-alive connections. A burst of hundreds of brand-new TCP connections in the same instant can overflow
// the server's accept queue (connection refused) before the app is even involved; a steady rate measures the app.
const RATE = Number(__ENV.RATE || 0);
const DURATION = __ENV.DURATION || '15s';
const HOLD = Number(__ENV.HOLD || 0); // socket scenario: keep each authenticated connection open this many seconds

export const options = {
  scenarios: {
    burst: RATE
      ? { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: DURATION, preAllocatedVUs: Math.min(VUS, 400), maxVUs: VUS }
      : { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '180s' },
  },
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  setupTimeout: '180s',
};

export function setup() {
  if (SCENARIO !== 'login') return {};
  // Register VUS accounts (not measured), 25 at a time.
  const accounts = [];
  for (let i = 0; i < VUS; i += 1) {
    const tag = `${Date.now()}${i}${Math.floor(Math.random() * 1e6)}`;
    accounts.push({ email: `k6-${tag}@example.com`, username: `k6${tag}` });
  }
  for (let i = 0; i < accounts.length; i += 25) {
    http.batch(
      accounts.slice(i, i + 25).map((a) => [
        'POST',
        `${BASE}/api/register`,
        { ...a, password: 'LoadTest123!', repeatPassword: 'LoadTest123!', firstName: 'K6', lastName: 'Load' },
      ]),
    );
  }
  return { accounts };
}

export default function (data) {
  const i = RATE ? exec.scenario.iterationInTest : __VU - 1;

  if (SCENARIO === 'messages') {
    const r = rooms[i % rooms.length];
    const res = http.post(
      `${BASE}/api/message`,
      { roomID: r.roomID, content: `k6 message ${i}`, type: 'text', clientID: `k6-${Date.now()}-${i}` },
      { headers: { Authorization: `Bearer ${r.senderToken}` } },
    );
    check(res, { 'status 200': (x) => x.status === 200 });
  } else if (SCENARIO === 'rooms') {
    const res = http.post(`${BASE}/api/rooms/list`, {}, { headers: { Authorization: `Bearer ${users.tokens[i % users.tokens.length]}` } });
    check(res, { 'status 200': (x) => x.status === 200 });
  } else if (SCENARIO === 'login') {
    const a = data.accounts[i % data.accounts.length];
    const res = http.post(`${BASE}/api/login`, { email: a.email, password: 'LoadTest123!' });
    check(res, { 'status 200': (x) => x.status === 200 });
  } else if (SCENARIO === 'upload') {
    const res = http.post(
      `${BASE}/api/upload/media`,
      { file: http.file(png, 'photo.png', 'image/png') },
      { headers: { Authorization: `Bearer ${users.tokens[i % users.tokens.length]}` } },
    );
    check(res, { 'status 200': (x) => x.status === 200 });
  } else if (SCENARIO === 'socket') {
    // Minimal Socket.IO (Engine.IO v4) client over a raw WebSocket: open -> connect namespace -> authenticate event.
    const url = `${BASE.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`;
    const start = Date.now();
    let authed = false;
    const res = ws.connect(url, {}, (socket) => {
      socket.on('message', (msg) => {
        if (msg.startsWith('0')) socket.send('40'); // Engine.IO open -> join default namespace
        else if (msg.startsWith('40')) socket.send(`42["authenticate",{"token":"${users.tokens[i % users.tokens.length]}"}]`);
        else if (msg.startsWith('42["authenticated"')) {
          authed = true;
          socketAuthMs.add(Date.now() - start);
          socketOk.add(1);
          if (!HOLD) socket.close();
        } else if (msg === '2') socket.send('3'); // ping -> pong
      });
      socket.setTimeout(() => socket.close(), HOLD ? HOLD * 1000 : 15000);
    });
    check(res, { 'ws upgraded (101)': (x) => x && x.status === 101 });
    check(authed, { authenticated: (x) => x === true });
  }
}
