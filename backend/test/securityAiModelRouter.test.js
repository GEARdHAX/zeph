const { routeModel, countSignalCategories, COMPLEXITY_THRESHOLD } = require('../src/services/securityAi/modelRouter');

describe('countSignalCategories', () => {
  it('counts zero categories for an empty context', () => {
    expect(countSignalCategories({})).toBe(0);
  });

  it('counts one category for auth-only signals', () => {
    expect(countSignalCategories({ failedLoginCount: 3 })).toBe(1);
  });

  it('counts distinct categories, not distinct fields within one category', () => {
    // failedLoginCount + rateLimitCount are both "auth" — still 1 category
    expect(countSignalCategories({ failedLoginCount: 3, rateLimitCount: 2 })).toBe(1);
  });

  it('counts multiple distinct categories', () => {
    const count = countSignalCategories({
      failedLoginCount: 3, processAnomalyCount: 1, portScanCount: 1, maliciousIpCount: 1, dnsAnomalyCount: 1,
    });
    expect(count).toBe(5);
  });
});

describe('routeModel', () => {
  it('always routes to config.ollamaModel when no large model is configured', () => {
    const config = { ollamaModel: 'llama3.2:1b', aiSecurityLargeModel: null };
    const complexContext = {
      failedLoginCount: 3, processAnomalyCount: 1, portScanCount: 1, maliciousIpCount: 1,
    };
    const result = routeModel(complexContext, config);
    expect(result.model).toBe('llama3.2:1b');
    expect(result.tier).toBe('default');
    expect(result.reason).toBe('no_large_model_configured');
  });

  it('routes simple contexts to the default model even when a large model IS configured', () => {
    const config = { ollamaModel: 'llama3.2:1b', aiSecurityLargeModel: 'llama3.1:7b' };
    const simpleContext = { failedLoginCount: 3 };
    const result = routeModel(simpleContext, config);
    expect(result.model).toBe('llama3.2:1b');
    expect(result.tier).toBe('default');
  });

  it('routes complex multi-signal contexts to the large model when configured', () => {
    const config = { ollamaModel: 'llama3.2:1b', aiSecurityLargeModel: 'llama3.1:7b' };
    const complexContext = {
      failedLoginCount: 3, processAnomalyCount: 1, portScanCount: 1, maliciousIpCount: 1, dnsAnomalyCount: 1,
    };
    expect(countSignalCategories(complexContext)).toBeGreaterThan(COMPLEXITY_THRESHOLD);
    const result = routeModel(complexContext, config);
    expect(result.model).toBe('llama3.1:7b');
    expect(result.tier).toBe('large');
  });

  it('never returns a model name outside config.ollamaModel/config.aiSecurityLargeModel', () => {
    const config = { ollamaModel: 'llama3.2:1b', aiSecurityLargeModel: 'llama3.1:7b' };
    const allContexts = [{}, { failedLoginCount: 1 }, {
      failedLoginCount: 1, processAnomalyCount: 1, portScanCount: 1, maliciousIpCount: 1, dnsAnomalyCount: 1,
    }];
    allContexts.forEach((ctx) => {
      const result = routeModel(ctx, config);
      expect([config.ollamaModel, config.aiSecurityLargeModel]).toContain(result.model);
    });
  });
});
