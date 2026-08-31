// Deterministic mock AI provider (spec section 52: "mock the AI provider,
// do NOT require Ollama for the normal CI test suite") — mirrors
// threatIntel/providers/mockProvider.js's exact shape and reasoning: fixed
// responses, no network, no timing variance, used only by tests via
// jest.mock('../src/ai/provider').
//
// Unlike the chat assistant's generate() (free-form text), securityAiService
// always requests format:'json' and expects a JSON string back — this mock
// returns JSON.stringify'd objects matching schema.js's expected shape by
// default, with knobs to return malformed/invalid output for negative tests.
const buildMockAiProvider = ({
  response = { anomalous: false, confidence: 10, category: 'other', signals: [], explanation: 'No anomaly detected in the provided signals.', recommendedAction: null },
  rawText = null, // overrides response entirely — for malformed-JSON / non-JSON tests
  failWith = null, // an Error to throw instead of responding — for timeout/network-failure tests
  latencyMs = 0,
} = {}) => {
  let callCount = 0;
  return {
    enabled: true,
    callCount: () => callCount,
    async generate(prompt, options = {}) {
      callCount += 1;
      if (latencyMs) await new Promise((resolve) => { setTimeout(resolve, latencyMs); });
      if (options.signal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (failWith) throw failWith;
      return rawText !== null ? rawText : JSON.stringify(response);
    },
  };
};

module.exports = { buildMockAiProvider };
