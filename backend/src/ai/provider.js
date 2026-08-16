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
  async generate(prompt) {
    const res = await fetch(`${config.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, prompt, stream: false }),
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
