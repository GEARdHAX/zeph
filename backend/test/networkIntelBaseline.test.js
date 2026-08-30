const store = require('../src/store');
const config = require('../config');
const {
  parseTrustedList, isTrustedDestination, isKnownCandidate,
} = require('../src/services/networkIntel/baseline');
const { closeNetworkIntelConnection } = require('../src/services/networkIntel/cache');

describe('parseTrustedList / isTrustedDestination', () => {
  it('parses a comma-separated list, trimming and lowercasing', () => {
    const set = parseTrustedList(' 203.0.113.10 , 203.0.113.11:6379 ');
    expect(set.has('203.0.113.10')).toBe(true);
    expect(set.has('203.0.113.11:6379')).toBe(true);
  });

  it('treats an empty/undefined list as trusting nothing', () => {
    expect(parseTrustedList('').size).toBe(0);
    expect(parseTrustedList(undefined).size).toBe(0);
  });

  it('matches a bare-IP entry regardless of port', () => {
    const set = parseTrustedList('203.0.113.10');
    expect(isTrustedDestination(set, '203.0.113.10', 443)).toBe(true);
    expect(isTrustedDestination(set, '203.0.113.10', 27017)).toBe(true);
  });

  it('matches an ip:port entry only on that exact port', () => {
    const set = parseTrustedList('203.0.113.11:6379');
    expect(isTrustedDestination(set, '203.0.113.11', 6379)).toBe(true);
    expect(isTrustedDestination(set, '203.0.113.11', 443)).toBe(false);
  });

  it('is case-insensitive on the IP', () => {
    const set = parseTrustedList('203.0.113.10');
    expect(isTrustedDestination(set, '203.0.113.10'.toUpperCase(), 443)).toBe(true);
  });

  it('returns false for a destination not in the list at all', () => {
    const set = parseTrustedList('203.0.113.10');
    expect(isTrustedDestination(set, '198.51.100.1', 443)).toBe(false);
  });
});

describe('isKnownCandidate — Redis unavailable (test default)', () => {
  it('fails safe to false (every destination looks "new") with no Redis configured', async () => {
    const original = store.config;
    store.config = { ...config, redisUrl: null };
    const result = await isKnownCandidate('203.0.113.5');
    expect(result).toBe(false);
    store.config = original;
  });

  afterAll(async () => {
    await closeNetworkIntelConnection();
  });
});

const hasRedis = !!process.env.REDIS_URL;
const describeIfRedis = hasRedis ? describe : describe.skip;

describeIfRedis('isKnownCandidate — real Redis', () => {
  beforeAll(() => {
    store.config = { ...config, redisUrl: process.env.REDIS_URL };
  });

  afterAll(async () => {
    await closeNetworkIntelConnection();
  });

  it('a first sighting is NOT a known candidate; a second sighting IS', async () => {
    // Unique per test run (Date.now()+random, not just a small random IPv4
    // octet) — a shared real Redis instance across runs/other test files
    // (e.g. a load test) can otherwise collide on a reused low-cardinality
    // fake IP and see a stale 30-day-TTL candidate from a PRIOR run,
    // producing a real, reproducible false failure (not infra flakiness).
    const ip = `203.0.113.${Date.now() % 250}-${Math.random().toString(36).slice(2)}`;
    const first = await isKnownCandidate(ip);
    const second = await isKnownCandidate(ip);
    expect(first).toBe(false);
    expect(second).toBe(true);
  });
});
