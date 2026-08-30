// ThreatIntelProvider abstraction (spec sections 6/7/30) — mirrors
// src/ai/provider.js's exact shape: a disabled no-op by default, one real
// implementation wired in behind config, and a uniform interface
// (lookupIndicator) the rest of the app calls without knowing which
// provider (or none) is behind it.
//
// Normalized result shape every provider MUST return:
//   { found, malicious, confidence, severity, categories, source, metadata, sourceId }
// found:false means "provider has no data" (maps to ThreatIndicator status
// UNKNOWN) — never conflated with found:true, malicious:false (a provider
// that actively vouches for the indicator as clean).

const disabledProvider = {
  enabled: false,
  name: 'disabled',
  async lookupIndicator() {
    return {
      found: false, malicious: false, confidence: 0, severity: 'low', categories: [], source: 'disabled', metadata: {}, sourceId: null,
    };
  },
};

const getProvider = (config) => {
  if (config.abuseIpDbEnabled && config.abuseIpDbApiKey) {
    // eslint-disable-next-line global-require
    const { buildAbuseIpDbProvider } = require('./providers/abuseIpDb');
    return buildAbuseIpDbProvider(config);
  }
  return disabledProvider;
};

module.exports = { getProvider, disabledProvider };
