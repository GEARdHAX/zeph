require('dotenv').config();
const store = require('../src/store');
const config = require('../config');
const { claimEventOnce, closeSensorDedupConnection } = require('../src/services/ebpf/sensorEventDedup');

describe('eBPF sensor event dedup — Redis unavailable (test default)', () => {
  it('claimEventOnce fails safe to "duplicate" (false) with no Redis configured', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const result = await claimEventOnce('sensor-1', 'evt-1');
    expect(result).toBe(false);
    store.config = original;
  });

  afterAll(async () => {
    await closeSensorDedupConnection();
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('eBPF sensor event dedup — real Redis', () => {
  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    await closeSensorDedupConnection();
  });

  it('first claim of a (sensorId, eventId) pair succeeds', async () => {
    const result = await claimEventOnce('sensor-a', `evt-${Date.now()}`);
    expect(result).toBe(true);
  });

  it('second claim of the SAME pair is rejected as a duplicate', async () => {
    const eventId = `evt-${Date.now()}`;
    const first = await claimEventOnce('sensor-b', eventId);
    const second = await claimEventOnce('sensor-b', eventId);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('the same eventId from a DIFFERENT sensor is a distinct claim (keyed by sensorId+eventId)', async () => {
    const eventId = `evt-${Date.now()}`;
    const first = await claimEventOnce('sensor-c1', eventId);
    const second = await claimEventOnce('sensor-c2', eventId);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });
});
