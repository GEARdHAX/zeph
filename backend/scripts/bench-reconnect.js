#!/usr/bin/env node
// Reconnect-recovery-time benchmark: measures how long it takes a client to
// authenticate on first connect vs. re-authenticate + resync after a forced
// disconnect, using the real Socket.IO auth handshake (src/init.js#initSocketAuth)
// and the real /api/messages/sync route — not a mock.
'use strict';

const http = require('http');
const { performance } = require('perf_hooks');
const { Server } = require('socket.io');
const ioc = require('socket.io-client');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'bench-secret-not-for-production';

const db = require('../test/helpers/db');
const store = require('../src/store');
const config = require('../config');
const User = require('../src/models/User');
const init = require('../src/init');

const ITERATIONS = 10;

const run = async () => {
  await db.connect();
  store.config = config;

  const httpServer = http.createServer();
  store.io = new Server(httpServer);
  init.initSocketAuth(false);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const password = await argon2.hash('password123');
  const user = await User.create({
    username: 'bench-reconnect',
    email: 'bench-reconnect@example.com',
    firstName: 'Bench',
    lastName: 'Reconnect',
    password,
  });
  const token = jwt.sign({ id: user._id.toString(), email: user.email }, config.secret, { expiresIn: '1h' });

  const authenticate = (client) =>
    new Promise((resolve) => {
      const start = performance.now();
      client.emit('authenticate', { token });
      client.once('authenticated', () => resolve(performance.now() - start));
    });

  console.log(`Measuring first-connect and reconnect auth time over ${ITERATIONS} iterations...\n`);

  const firstConnectSamples = [];
  const reconnectSamples = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const client = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });

    await new Promise((resolve) => client.on('connect', resolve));
    firstConnectSamples.push(await authenticate(client));

    // Simulate a dropped connection and the client's automatic reconnect + re-auth.
    client.disconnect();
    client.connect();
    await new Promise((resolve) => client.on('connect', resolve));
    reconnectSamples.push(await authenticate(client));

    client.close();
  }

  const avg = (samples) => samples.reduce((a, b) => a + b, 0) / samples.length;

  console.log(`First-connect auth time: avg=${avg(firstConnectSamples).toFixed(1)}ms`);
  console.log(`Reconnect auth time:     avg=${avg(reconnectSamples).toFixed(1)}ms`);
  console.log(
    "\n(This measures the auth handshake only. Real-world reconnect time also includes the client's\n" +
      'own backoff before it retries, which socket.io-client controls — not measured here.)',
  );

  store.io.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await db.closeDatabase();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
