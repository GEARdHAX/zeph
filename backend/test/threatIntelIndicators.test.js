const {
  IndicatorTypes, detectType, normalizeIndicator, isPrivateOrReservedIp, indicatorKey,
} = require('../src/services/threatIntel/indicators');

describe('threatIntel/indicators — detectType', () => {
  it.each([
    ['1.2.3.4', IndicatorTypes.IP],
    ['::1', IndicatorTypes.IP],
    ['2001:4860:4860::8888', IndicatorTypes.IP],
    ['example.com', IndicatorTypes.DOMAIN],
    ['sub.example.co.uk', IndicatorTypes.DOMAIN],
    ['http://example.com', IndicatorTypes.URL],
    ['https://example.com/path?x=1', IndicatorTypes.URL],
    ['5d41402abc4b2a76b9719d911017c592', IndicatorTypes.HASH], // md5
    ['aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d', IndicatorTypes.HASH], // sha1
    ['9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', IndicatorTypes.HASH], // sha256
  ])('detects %s as %s', (input, expected) => {
    expect(detectType(input)).toBe(expected);
  });

  it.each([
    [''],
    [null],
    [undefined],
    ['not a valid indicator at all'],
    ['just-some-text-no-tld'],
  ])('returns null for invalid input: %s', (input) => {
    expect(detectType(input)).toBeNull();
  });
});

describe('threatIntel/indicators — normalizeIndicator', () => {
  it('normalizes an IP to lowercase, unchanged otherwise', () => {
    expect(normalizeIndicator('203.0.113.10')).toEqual({ type: 'IP', normalized: '203.0.113.10' });
  });

  it('rejects a malformed/invalid IP', () => {
    expect(normalizeIndicator('999.999.999.999')).toBeNull();
  });

  it('normalizes domain case and strips a trailing root dot consistently', () => {
    const variants = ['example.com', 'Example.com', 'EXAMPLE.COM', 'example.com.', 'EXAMPLE.COM.'];
    variants.forEach((v) => {
      expect(normalizeIndicator(v)).toEqual({ type: 'DOMAIN', normalized: 'example.com' });
    });
  });

  it('normalizes URL scheme/host case, preserves path/query case, strips credentials', () => {
    const result = normalizeIndicator('HTTP://User:Pass@Example.COM/Path?X=1');
    expect(result.type).toBe('URL');
    expect(result.normalized).toBe('http://example.com/Path?X=1');
    expect(result.normalized).not.toContain('User');
    expect(result.normalized).not.toContain('Pass');
  });

  it('rejects a malformed URL', () => {
    expect(normalizeIndicator('not-a-url')).toBeNull();
  });

  it('normalizes hash case consistently for md5/sha1/sha256', () => {
    expect(normalizeIndicator('5D41402ABC4B2A76B9719D911017C592'))
      .toEqual({ type: 'HASH', normalized: '5d41402abc4b2a76b9719d911017c592' });
  });

  it('rejects a hash of the wrong length', () => {
    expect(normalizeIndicator('deadbeef')).toBeNull();
  });

  it('returns null for empty/garbage input rather than guessing', () => {
    expect(normalizeIndicator('')).toBeNull();
    expect(normalizeIndicator('   ')).toBeNull();
    expect(normalizeIndicator('complete nonsense')).toBeNull();
  });
});

describe('threatIntel/indicators — isPrivateOrReservedIp (spec section 27)', () => {
  it.each([
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.15.0.1', false], // just outside the 172.16.0.0/12 range
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.1.1', true],
    ['8.8.8.8', false],
    ['203.0.113.10', false],
    ['1.1.1.1', false],
  ])('%s -> private/reserved: %s', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  it('IPv6 loopback and link-local are treated as private', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
  });

  it('a real public IPv6 address is not private', () => {
    expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false);
  });

  it('an unparseable string fails toward "do not call the provider" (treated as private)', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });
});

describe('threatIntel/indicators — indicatorKey', () => {
  it('is deterministic for the same type+normalized value', () => {
    expect(indicatorKey('IP', '1.2.3.4')).toBe(indicatorKey('IP', '1.2.3.4'));
  });

  it('differs across types even with the same normalized string', () => {
    expect(indicatorKey('IP', 'x')).not.toBe(indicatorKey('DOMAIN', 'x'));
  });

  it('produces a fixed-length key regardless of input length', () => {
    const shortKey = indicatorKey('IP', '1.2.3.4');
    const longKey = indicatorKey('URL', `http://example.com/${'a'.repeat(500)}`);
    expect(shortKey.length).toBe(longKey.length);
  });
});
