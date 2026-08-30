const { looksRegular } = require('../src/services/networkIntel/beaconDetection');

describe('looksRegular', () => {
  it('returns false with fewer than minOccurrences timestamps', () => {
    expect(looksRegular([1000, 2000], 3)).toBe(false);
  });

  it('returns true for near-perfectly regular intervals', () => {
    const base = 1_000_000;
    const timestamps = [base, base + 60000, base + 120000, base + 180000, base + 240000];
    expect(looksRegular(timestamps, 3)).toBe(true);
  });

  it('returns false for highly irregular (jittery) intervals', () => {
    const base = 1_000_000;
    const timestamps = [base, base + 5000, base + 90000, base + 91000, base + 400000];
    expect(looksRegular(timestamps, 3)).toBe(false);
  });

  it('returns false for a burst (near-zero gaps)', () => {
    const base = 1_000_000;
    const timestamps = [base, base + 1, base + 2, base + 3];
    expect(looksRegular(timestamps, 3)).toBe(false);
  });

  it('tolerates minor jitter within the configured coefficient-of-variation bound', () => {
    const base = 1_000_000;
    // ~60s intervals with a few seconds of jitter — well within 15% CoV
    const timestamps = [base, base + 58000, base + 121000, base + 179000, base + 242000];
    expect(looksRegular(timestamps, 3)).toBe(true);
  });

  it('is order-independent (sorts internally)', () => {
    const base = 1_000_000;
    const sorted = [base, base + 60000, base + 120000, base + 180000];
    const shuffled = [base + 180000, base, base + 120000, base + 60000];
    expect(looksRegular(shuffled, 3)).toBe(looksRegular(sorted, 3));
  });
});
