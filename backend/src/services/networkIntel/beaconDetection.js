// Basic deterministic beaconing signal (spec section 20) — regular-interval
// repeated connections to the SAME destination. Pure function: given a
// sorted list of connection timestamps (ms), decide whether the spacing is
// "regular enough" to be worth flagging. Deliberately simple (coefficient
// of variation of the inter-arrival gaps) — this is NOT a claim of C2
// (spec: "do NOT label it C2 unless sufficient evidence exists... regular
// traffic can look like beaconing"), just a bounded heuristic that produces
// POSSIBLE_BEACONING, nothing stronger.
const MAX_COEFFICIENT_OF_VARIATION = 0.15; // gaps within +-15% of their mean count as "regular"; a human clicking a link repeatedly, or bursty legitimate polling, has far more jitter than that
const MIN_MEAN_GAP_MS = 1000; // a beacon INTERVAL is a spaced-out repeated callback, not a burst of near-simultaneous packets — a TCP retry storm or a single logical request split into several flows can be perfectly "regular" a few ms apart without being beacon-shaped at all

const looksRegular = (timestampsMs, minOccurrences) => {
  if (!Array.isArray(timestampsMs) || timestampsMs.length < minOccurrences) return false;

  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i] - sorted[i - 1]);
  if (gaps.length < minOccurrences - 1) return false;

  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  if (mean < MIN_MEAN_GAP_MS) return false; // too close together to be a beacon interval — see MIN_MEAN_GAP_MS

  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  return coefficientOfVariation <= MAX_COEFFICIENT_OF_VARIATION;
};

module.exports = { looksRegular, MAX_COEFFICIENT_OF_VARIATION };
