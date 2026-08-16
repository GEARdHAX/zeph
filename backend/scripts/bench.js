#!/usr/bin/env node
// Measurable-improvement benchmark: API latency, payload size, and DB query time
// for the hot-path routes touched by the security/performance work in this repo's
// engineering plan. Boots against an in-memory Mongo (mongodb-memory-server) — no
// external services needed to run this locally or in CI.
//
// Usage: node scripts/bench.js
'use strict';

const { performance } = require('perf_hooks');
const request = require('supertest');
const argon2 = require('argon2');

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'bench-secret-not-for-production';

const db = require('../test/helpers/db');
const { buildApp, tokenFor } = require('../test/helpers/app');
const User = require('../src/models/User');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');

const ROOM_MEMBER_COUNT = 2;
const MESSAGE_SEED_COUNT = 500; // realistic-sized room history to measure list/paginate against
const ITERATIONS = 30;

const createUser = async (n) => {
  const password = await argon2.hash('password123');
  return User.create({
    username: `bench-user-${n}`,
    email: `bench-user-${n}@example.com`,
    firstName: 'Bench',
    lastName: `User${n}`,
    password,
  });
};

const percentile = (sortedMs, p) => sortedMs[Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length))];

const summarize = (label, samplesMs, payloadBytes) => {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const avg = samplesMs.reduce((a, b) => a + b, 0) / samplesMs.length;
  console.log(
    `${label.padEnd(28)} avg=${avg.toFixed(1)}ms  p50=${percentile(sorted, 50).toFixed(1)}ms  ` +
      `p95=${percentile(sorted, 95).toFixed(1)}ms  payload=${(payloadBytes / 1024).toFixed(1)}KB`,
  );
};

const timeRequest = async (fn) => {
  const start = performance.now();
  const res = await fn();
  const elapsed = performance.now() - start;
  const bytes = Buffer.byteLength(JSON.stringify(res.body || {}));
  return { elapsed, bytes, res };
};

const run = async () => {
  console.log('Seeding in-memory DB...');
  await db.connect();
  const app = buildApp();
  // /healthz is mounted directly on the app in index.js (not under the /api router) —
  // wire it the same way here so its live-ping timing is measuring the real code path.
  app.get('/healthz', require('../src/routes/health'));

  const users = [];
  for (let i = 0; i < ROOM_MEMBER_COUNT; i++) users.push(await createUser(i));
  const room = await Room.create({ people: users.map((u) => u._id), title: 'Bench Room', isGroup: true });

  const messageDocs = [];
  for (let i = 0; i < MESSAGE_SEED_COUNT; i++) {
    messageDocs.push({ author: users[0]._id, room: room._id, content: `message ${i}`, type: 'text' });
  }
  await Message.insertMany(messageDocs);
  await Room.updateOne({ _id: room._id }, { $set: { lastUpdate: new Date() } });

  const token = tokenFor(users[0]);
  console.log(`Seeded ${MESSAGE_SEED_COUNT} messages in 1 room, ${ROOM_MEMBER_COUNT} users.\n`);
  console.log(`Running ${ITERATIONS} iterations per route...\n`);

  // --- POST /api/room/get (single room lookup, membership-checked) ---
  {
    const samples = [];
    let bytes = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const { elapsed, bytes: b } = await timeRequest(() =>
        request(app).post('/api/room/get').set('Authorization', `Bearer ${token}`).send({ id: room._id.toString() }),
      );
      samples.push(elapsed);
      bytes = b;
    }
    summarize('POST /room/get', samples, bytes);
  }

  // --- POST /api/messages/more (cursor pagination, the primary chat-history read path) ---
  {
    const samples = [];
    let bytes = 0;
    const latest = await Message.findOne({ room: room._id }).sort({ _id: -1 });
    for (let i = 0; i < ITERATIONS; i++) {
      const { elapsed, bytes: b } = await timeRequest(() =>
        request(app)
          .post('/api/messages/more')
          .set('Authorization', `Bearer ${token}`)
          .send({ roomID: room._id.toString(), firstMessageID: latest._id.toString() }),
      );
      samples.push(elapsed);
      bytes = b;
    }
    summarize('POST /messages/more', samples, bytes);
  }

  // --- POST /api/messages/sync (reconnect resync path) ---
  {
    const samples = [];
    let bytes = 0;
    const midpoint = await Message.find({ room: room._id }).sort({ _id: 1 }).skip(250).limit(1);
    for (let i = 0; i < ITERATIONS; i++) {
      const { elapsed, bytes: b } = await timeRequest(() =>
        request(app)
          .post('/api/messages/sync')
          .set('Authorization', `Bearer ${token}`)
          .send({ roomID: room._id.toString(), lastMessageID: midpoint[0]._id.toString() }),
      );
      samples.push(elapsed);
      bytes = b;
    }
    summarize('POST /messages/sync', samples, bytes);
  }

  // --- POST /api/search (indexed username/email/name regex search) ---
  {
    const samples = [];
    let bytes = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const { elapsed, bytes: b } = await timeRequest(() =>
        request(app).post('/api/search').set('Authorization', `Bearer ${token}`).send({ search: 'Bench' }),
      );
      samples.push(elapsed);
      bytes = b;
    }
    summarize('POST /search', samples, bytes);
  }

  // --- GET /healthz (live DB ping, not the old stale-flag check) ---
  {
    const samples = [];
    let bytes = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const { elapsed, bytes: b } = await timeRequest(() => request(app).get('/healthz'));
      samples.push(elapsed);
      bytes = b;
    }
    summarize('GET /healthz (live ping)', samples, bytes);
  }

  await db.closeDatabase();
  console.log('\nDone. Re-run after schema/query changes to compare against these numbers.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
