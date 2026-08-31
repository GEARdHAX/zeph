// Shared stats helper for every load-test script in this directory —
// nothing here depends on a load-test library (autocannon/artillery/k6),
// just plain arithmetic over an array of recorded latencies. Keeps every
// script's "record duration -> report p50/p95/p99" logic identical instead
// of each script rolling its own.
const percentile = (sortedMs, p) => {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
};

const summarize = (latenciesMs, { errors = 0, total = latenciesMs.length } = {}) => {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  return {
    total,
    errors,
    errorRate: total > 0 ? +(errors / total * 100).toFixed(2) : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] || 0,
    max: sorted[sorted.length - 1] || 0,
  };
};

const printSummary = (label, stats, extra = {}) => {
  console.log(`\n${label}`);
  console.log('-'.repeat(label.length));
  console.log(`  total: ${stats.total}   errors: ${stats.errors} (${stats.errorRate}%)`);
  console.log(`  p50: ${stats.p50}ms   p95: ${stats.p95}ms   p99: ${stats.p99}ms   min: ${stats.min}ms   max: ${stats.max}ms`);
  Object.entries(extra).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
};

module.exports = { summarize, printSummary, percentile };
