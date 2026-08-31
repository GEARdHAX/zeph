// Phase 8 Socket.IO connection load test — uses socket.io-client, already a
// backend devDependency (test/message-delivered.test.js and friends use it
// the same way), no new dependency added.
//
// Measures: concurrent connection capacity, time-to-authenticated, and
// message-delivery round-trip latency (one user's DM send -> the personal-
// room-per-user delivery model, see events/*.js -> the recipient socket's
// 'message-in' event).
//
// Usage: node loadtest/socket-load.js [concurrency] [baseUrl]

const { io } = require('socket.io-client');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { summarize, printSummary } = require('./lib/percentiles');

const concurrency = Number(process.argv[2]) || 50;
const baseUrl = process.argv[3] || 'http://127.0.0.1:4099';
const CONNECT_TIMEOUT_MS = 10000;

const connectAndAuth = (token) => new Promise((resolve, reject) => {
  const start = process.hrtime.bigint();
  const socket = io(baseUrl, { transports: ['websocket'], reconnection: false, timeout: CONNECT_TIMEOUT_MS });

  const timer = setTimeout(() => {
    socket.disconnect();
    reject(new Error('connect/auth timeout'));
  }, CONNECT_TIMEOUT_MS);

  socket.on('connect', () => socket.emit('authenticate', { token }));
  socket.on('authenticated', () => {
    clearTimeout(timer);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    resolve({ socket, ms });
  });
  socket.on('unauthorized', (data) => {
    clearTimeout(timer);
    socket.disconnect();
    reject(new Error(`unauthorized: ${data?.message}`));
  });
  socket.on('connect_error', (err) => {
    clearTimeout(timer);
    reject(err);
  });
});

const main = async () => {
  console.log(`Phase 8 Socket.IO load test — concurrency=${concurrency}, target=${baseUrl}`);

  console.log(`Seeding ${concurrency} users...`);
  const seedOut = execSync(`node "${path.join(__dirname, 'seed.js')}" ${concurrency}`, {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const { tokens } = JSON.parse(seedOut.trim().split('\n').pop());

  // ── Connection capacity: N concurrent connect+authenticate handshakes.
  // token carried through each result (not just index-implied) so a
  // partial-failure run doesn't desync sockets[i] from the token that
  // authenticated it.
  const results = await Promise.all(tokens.map(async (token) => {
    try {
      const { socket, ms } = await connectAndAuth(token);
      return {
        ok: true, socket, ms, token,
      };
    } catch (err) {
      return { ok: false, err };
    }
  }));
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const stats = summarize(ok.map((r) => r.ms), { errors: failed.length, total: results.length });
  printSummary('Connect + authenticate', stats);
  if (failed.length > 0) console.error(`  [first error] ${failed[0].err.message}`);

  const sockets = ok.map((r) => r.socket);
  const connectedTokens = ok.map((r) => r.token);
  console.log(`\n${sockets.length}/${concurrency} sockets connected and authenticated.`);

  // ── Real message-in delivery latency: for each connected socket, have
  // its OWN user send a real DM via POST /api/message (not a synthetic
  // emit) to the next user in the ring, and measure how long that
  // socket's OWN store.io.to(userId).emit('message-in', ...) push (see
  // message.js) takes to arrive. This is the actual personal-room delivery
  // path a real client goes through, under N concurrently-connected
  // sockets — not a stand-in for it.
  if (sockets.length >= 2) {
    // Rooms created directly via the model layer (seed-rooms.js) — same
    // reasoning as message-only-load.js: room CREATION has its own
    // separately-measured limiter (discoveryLimiter), a different concern
    // from delivery latency.
    const decodeId = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')).id;
    const userIds = connectedTokens.map(decodeId);
    const usersFile = path.join(os.tmpdir(), `zeph-loadtest-socket-users-${Date.now()}.json`);
    fs.writeFileSync(usersFile, JSON.stringify({ tokens: connectedTokens, userIds }));

    const roomsOut = execSync(`node "${path.join(__dirname, 'seed-rooms.js')}" "${usersFile}"`, {
      cwd: path.join(__dirname, '..'),
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const { rooms } = JSON.parse(roomsOut.trim().split('\n').pop());
    fs.unlinkSync(usersFile);

    const form = (fields) => {
      const f = new FormData();
      Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) f.append(k, v); });
      return f;
    };

    let firstSendError = null;
    const deliveryResults = await Promise.all(rooms.map((r, i) => new Promise((resolve) => {
      const recipientSocket = sockets[(i + 1) % sockets.length];
      const timer = setTimeout(() => resolve({ ok: false, ms: 5000 }), 5000);
      const start = process.hrtime.bigint();
      recipientSocket.once('message-in', () => {
        clearTimeout(timer);
        resolve({ ok: true, ms: Number(process.hrtime.bigint() - start) / 1e6 });
      });
      fetch(`${baseUrl}/api/message`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${r.senderToken}` },
        body: form({
          roomID: r.roomID, content: `socket delivery test ${i}`, type: 'text', clientID: `lt-socket-${Date.now()}-${i}`,
        }),
      }).then((res) => {
        if (!res.ok && !firstSendError) firstSendError = `HTTP send itself failed: ${res.status}`;
      }).catch((err) => { if (!firstSendError) firstSendError = err.message; });
    })));

    const delivered = deliveryResults.filter((r) => r.ok);
    const deliveryStats = summarize(delivered.map((r) => r.ms), { errors: deliveryResults.length - delivered.length, total: deliveryResults.length });
    printSummary('Real-time message-in delivery latency (HTTP send -> socket receipt)', deliveryStats);
    if (firstSendError) console.error(`  [note] some/all underlying HTTP sends failed, not the socket delivery path: ${firstSendError}`);
  }

  sockets.forEach((s) => s.disconnect());
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
