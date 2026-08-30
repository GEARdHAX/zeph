const store = require('../src/store');
const config = require('../config');
const { recordDnsQuery } = require('../src/services/networkIntel/dnsCounters');
const { closeNetworkIntelConnection } = require('../src/services/networkIntel/cache');

describe('recordDnsQuery — Redis unavailable (test default)', () => {
  it('returns all-zero counters with no Redis configured', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const result = await recordDnsQuery({
      sensorId: 's1', pid: 100, domain: 'example.com', nxdomain: false, windowMs: 60000,
    });
    expect(result).toEqual({ distinctDomains: 0, nxdomainCount: 0 });
    store.config = original;
  });

  afterAll(async () => {
    await closeNetworkIntelConnection();
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('recordDnsQuery — real Redis', () => {
  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    await closeNetworkIntelConnection();
  });

  it('tracks distinct domains queried by the same (sensorId, pid)', async () => {
    const sensorId = `sensor-${Date.now()}`;
    const pid = 900;
    await recordDnsQuery({
      sensorId, pid, domain: 'a.example.com', windowMs: 60000,
    });
    const result = await recordDnsQuery({
      sensorId, pid, domain: 'b.example.com', windowMs: 60000,
    });
    expect(result.distinctDomains).toBe(2);
  });

  it('counts NXDOMAIN responses separately from query volume', async () => {
    const sensorId = `sensor-${Date.now()}`;
    const pid = 901;
    await recordDnsQuery({
      sensorId, pid, domain: 'clean.example.com', nxdomain: false, windowMs: 60000,
    });
    const result = await recordDnsQuery({
      sensorId, pid, domain: 'bogus1.example.com', nxdomain: true, windowMs: 60000,
    });
    expect(result.nxdomainCount).toBe(1);
    expect(result.distinctDomains).toBe(2);
  });
});
