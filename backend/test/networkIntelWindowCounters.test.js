const store = require('../src/store');
const config = require('../config');
const { recordFlow } = require('../src/services/networkIntel/windowCounters');
const { closeNetworkIntelConnection } = require('../src/services/networkIntel/cache');

describe('recordFlow — Redis unavailable (test default)', () => {
  it('returns all-zero counters (fail toward no-signal) with no Redis configured', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const result = await recordFlow({
      sensorId: 's1', pid: 100, destinationIp: '203.0.113.5', destinationPort: 443, bytesSent: 10, windowMs: 60000,
    });
    expect(result).toEqual({
      distinctPorts: 0, distinctHosts: 0, beaconTimestamps: [], cumulativeBytes: 0,
    });
    store.config = original;
  });

  it('returns all-zero counters when pid is missing', async () => {
    const result = await recordFlow({
      sensorId: 's1', pid: undefined, destinationIp: '203.0.113.5', destinationPort: 443, windowMs: 60000,
    });
    expect(result.distinctPorts).toBe(0);
  });

  afterAll(async () => {
    await closeNetworkIntelConnection();
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('recordFlow — real Redis', () => {
  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    await closeNetworkIntelConnection();
  });

  it('tracks distinct destination ports for the same (sensorId, pid)', async () => {
    const sensorId = `sensor-${Date.now()}`;
    const pid = 500;
    await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.5', destinationPort: 80, windowMs: 60000,
    });
    await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.5', destinationPort: 443, windowMs: 60000,
    });
    const result = await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.5', destinationPort: 8080, windowMs: 60000,
    });
    expect(result.distinctPorts).toBe(3);
  });

  it('tracks distinct destination hosts for the same (sensorId, pid)', async () => {
    const sensorId = `sensor-${Date.now()}`;
    const pid = 501;
    await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.1', destinationPort: 443, windowMs: 60000,
    });
    const result = await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.2', destinationPort: 443, windowMs: 60000,
    });
    expect(result.distinctHosts).toBe(2);
  });

  it('a different pid does not share counters with another pid', async () => {
    const sensorId = `sensor-${Date.now()}`;
    await recordFlow({
      sensorId, pid: 601, destinationIp: '203.0.113.1', destinationPort: 1, windowMs: 60000,
    });
    await recordFlow({
      sensorId, pid: 601, destinationIp: '203.0.113.1', destinationPort: 2, windowMs: 60000,
    });
    const other = await recordFlow({
      sensorId, pid: 602, destinationIp: '203.0.113.1', destinationPort: 3, windowMs: 60000,
    });
    expect(other.distinctPorts).toBe(1);
  });

  it('accumulates bytesSent per destination for exfiltration detection', async () => {
    const sensorId = `sensor-${Date.now()}`;
    const pid = 700;
    await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.9', destinationPort: 443, bytesSent: 1000, windowMs: 60000,
    });
    const result = await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.9', destinationPort: 443, bytesSent: 2000, windowMs: 60000,
    });
    expect(result.cumulativeBytes).toBe(3000);
  });

  it('tracks connection timestamps per destination for beacon detection', async () => {
    const sensorId = `sensor-${Date.now()}`;
    const pid = 800;
    await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.20', destinationPort: 443, windowMs: 60000,
    });
    const result = await recordFlow({
      sensorId, pid, destinationIp: '203.0.113.20', destinationPort: 443, windowMs: 60000,
    });
    expect(result.beaconTimestamps.length).toBe(2);
  });
});
