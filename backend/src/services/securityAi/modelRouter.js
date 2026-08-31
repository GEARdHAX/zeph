// Deterministic model routing (spec sections 17/62/63) — "simple anomaly
// -> 1B, complex multi-signal correlation -> 7B," configurable, never
// hard-failing merely because a larger model isn't installed.
//
// Honest baseline: ZEPH's existing AI config (config.js's ollamaModel,
// defaulting to llama3.2:1b) only ever configured ONE model — there was no
// pre-existing "1B -> 7B" routing anywhere in this codebase before this
// file. AI_SECURITY_LARGE_MODEL is a NEW, optional config value this phase
// introduces; when unset, every analysis routes to the same single model
// config.ollamaModel already names — routing degrades to "always the one
// configured model," never an error, matching spec section 63's "do not
// silently lower security guarantees" (there IS no larger model to fall
// back FROM in that case, so this isn't a degradation, just the honest
// single-model baseline).
//
// Complexity signal: the NUMBER of distinct signal categories present in
// the sanitized context — a single-signal auth check (just failedLoginCount)
// is "simple"; a context correlating process+network+threat-intel signals
// together is "complex." Deterministic, cheap, and doesn't require a
// second model call just to decide which model to use.
const COMPLEXITY_THRESHOLD = 2; // >=3 distinct non-zero signal categories routes to the large model when one is configured

const countSignalCategories = (context) => {
  let categories = 0;
  if ((context.failedLoginCount || 0) > 0 || (context.rateLimitCount || 0) > 0 || (context.permissionDeniedCount || 0) > 0 || context.newDevice) categories += 1;
  if ((context.processAnomalyCount || 0) > 0) categories += 1;
  if ((context.networkAnomalyCount || 0) > 0 || (context.portScanCount || 0) > 0 || (context.hostScanCount || 0) > 0 || (context.beaconingCount || 0) > 0 || (context.exfiltrationCount || 0) > 0) categories += 1;
  if ((context.maliciousIpCount || 0) > 0 || (context.threatSignals || []).length > 0) categories += 1;
  if ((context.dnsAnomalyCount || 0) > 0) categories += 1;
  return categories;
};

// Returns the model NAME to pass as provider.generate(prompt, { model }).
// Never returns something that isn't config.ollamaModel or
// config.aiSecurityLargeModel — no arbitrary model name can be requested
// through this path.
const routeModel = (context, config) => {
  const largeModel = config.aiSecurityLargeModel || null;
  if (!largeModel) return { model: config.ollamaModel, tier: 'default', reason: 'no_large_model_configured' };

  const complexity = countSignalCategories(context);
  if (complexity > COMPLEXITY_THRESHOLD) {
    return { model: largeModel, tier: 'large', reason: 'multi_signal_correlation' };
  }
  return { model: config.ollamaModel, tier: 'default', reason: 'simple_analysis' };
};

module.exports = { routeModel, countSignalCategories, COMPLEXITY_THRESHOLD };
