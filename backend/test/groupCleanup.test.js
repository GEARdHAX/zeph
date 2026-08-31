require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const db = require('./helpers/db');
const { closeQueueConnection } = require('../src/queues/connection');
const { enqueueGroupCleanup, getQueue } = require('../src/queues/groupCleanup');
const { processGroupCleanup } = require('../src/queues/groupCleanupWorker');
const Message = require('../src/models/Message');
const Media = require('../src/models/Media');
const GroupInvite = require('../src/models/GroupInvite');
const Room = require('../src/models/Room');
const User = require('../src/models/User');
const mongoose = require('mongoose');

// Exercises the actual queue against the real Redis instance from .env
// (same instance verified working by setupRedisAdapter's own test suite) —
// this is intentional, not accidental leakage: closeQueueConnection() in
// afterAll guarantees a clean shutdown, and every job uses a throwaway
// groupId. Falls back to a no-op skip if REDIS_URL genuinely isn't set
// (e.g. a CI environment without the secret), matching the module's own
// best-effort contract rather than failing the suite outright.
const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

beforeAll(async () => {
  // Full config (not just redisUrl) — storage.js's local-disk fallback
  // (used by deleteObject when R2 env vars aren't set) needs dataFolder.
  store.config = { ...config, redisUrl: process.env.REDIS_URL };
  await db.connect();
});

afterAll(async () => {
  const q = getQueue();
  if (q) await q.close();
  await closeQueueConnection();
  await db.closeDatabase();
});

afterEach(async () => {
  await db.clearDatabase();
});

describe('enqueueGroupCleanup — no Redis configured', () => {
  it('does not throw when redisUrl is unset (best-effort no-op)', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    await expect(enqueueGroupCleanup('507f1f77bcf86cd799439011')).resolves.toBeUndefined();
    store.config = original;
  });
});

describeIfRedis('enqueueGroupCleanup — real Redis', () => {
  it('adds a delayed job with the groupId as jobId, deduplicating repeat calls', async () => {
    const groupId = new mongoose.Types.ObjectId().toString();

    await enqueueGroupCleanup(groupId);
    await enqueueGroupCleanup(groupId); // same jobId — must not duplicate

    const q = getQueue();
    const job = await q.getJob(groupId);
    expect(job).toBeDefined();
    expect(job.data.groupId).toBe(groupId);
    expect(job.opts.delay).toBeGreaterThan(0);

    await job.remove();
  });

  // Phase 7 audit finding: this queue previously had no
  // removeOnComplete/removeOnFail — completed/failed job records
  // accumulated in Redis indefinitely, unlike security-ai-analysis's
  // queue, which already bounded both.
  it('bounds removeOnComplete/removeOnFail so job records do not accumulate forever', async () => {
    const groupId = new mongoose.Types.ObjectId().toString();
    await enqueueGroupCleanup(groupId);

    const q = getQueue();
    const job = await q.getJob(groupId);
    expect(job.opts.removeOnComplete).toEqual({ age: 24 * 60 * 60 });
    expect(job.opts.removeOnFail).toEqual({ age: 24 * 60 * 60 });

    await job.remove();
  });
});

describe('processGroupCleanup — the actual cleanup work', () => {
  const createUser = async () => User.create({
    username: `user-${Math.random().toString(36).slice(2)}`,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    firstName: 'Test',
    lastName: 'User',
    password: 'irrelevant-hash',
  });

  it('deletes messages, their referenced Media (DB rows), and the group\'s invites — leaves the Room itself untouched', async () => {
    const owner = await createUser();
    const room = await Room.create({ people: [owner._id], isGroup: true, title: 'Doomed Group', disabledAt: new Date() });

    const media = await Media.create({
      uploaderId: owner._id, originalName: 'photo.jpg', mimeType: 'image/jpeg', category: 'image', size: 100, storageKey: 'nonexistent/key.jpg',
    });
    await Message.create({ room: room._id, author: owner._id, content: 'hi', type: 'text' });
    await Message.create({
      room: room._id, author: owner._id, type: 'file', media: media._id,
    });
    await GroupInvite.create({
      group: room._id, creator: owner._id, tokenHash: 'faketokenhash', expiresAt: new Date(Date.now() + 100000),
    });

    await processGroupCleanup({ data: { groupId: room._id.toString() } });

    expect(await Message.countDocuments({ room: room._id })).toBe(0);
    expect(await Media.findById(media._id)).toBeNull();
    expect(await GroupInvite.countDocuments({ group: room._id })).toBe(0);
    // Room itself is never hard-deleted — matches every other soft-delete in this app.
    expect(await Room.findById(room._id)).not.toBeNull();
  });

  it('is a safe no-op for a group with no messages/media/invites', async () => {
    const owner = await createUser();
    const room = await Room.create({ people: [owner._id], isGroup: true, title: 'Empty Group', disabledAt: new Date() });

    await expect(processGroupCleanup({ data: { groupId: room._id.toString() } })).resolves.toBeUndefined();
    expect(await Room.findById(room._id)).not.toBeNull();
  });
});
