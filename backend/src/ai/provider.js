// AI provider abstraction: Chat → this service → a provider implementation, or a
// disabled no-op if AI_PROVIDER is unset. Callers never branch on whether AI is
// configured — they just call the interface and check `.enabled`.
//
// Only 'ollama' (local, self-hosted, no API key) is implemented. Adding a cloud
// provider later means adding one more case here — the interface (generate(prompt))
// doesn't change.

const disabledProvider = {
  enabled: false,
  async generate() {
    throw new Error('AI features are disabled (AI_PROVIDER is not set).');
  },
};

const buildOllamaProvider = (config) => ({
  enabled: true,
  async generate(prompt, options = {}) {
    // options.model lets a caller (securityAi/modelRouter.js) route a
    // single request to a different installed model than config.model's
    // default (e.g. a larger model for complex multi-signal correlation) —
    // additive, so every existing caller that never passes options keeps
    // using config.model exactly as before. options.timeoutMs/signal let a
    // caller enforce its own deadline (securityAiService.js's
    // SECURITY_AI_TIMEOUT_MS) without every caller needing to know Ollama
    // specifically supports AbortSignal.
    const res = await fetch(`${config.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || config.model,
        prompt,
        stream: false,
        // Ollama's documented JSON-mode constraint (spec section 11: "do
        // not depend on free-form model responses for security logic") —
        // only set when the caller asks for it; the chat assistant
        // (summarize/translate/draftReply) wants free-form prose and never
        // passes this.
        ...(options.format ? { format: options.format } : {}),
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.response;
  },
});

const getProvider = (config) => {
  if (config.aiProvider === 'ollama') {
    return buildOllamaProvider({ url: config.ollamaUrl, model: config.ollamaModel });
  }
  return disabledProvider;
};

module.exports = { getProvider };
