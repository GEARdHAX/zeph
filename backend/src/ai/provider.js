// AI provider abstraction (Zeph AI, Phase 2): Chat → this service → a provider
// implementation, or a disabled no-op if AI_PROVIDER is unset. Callers never
// branch on whether AI is configured — they just call the interface and check
// `.enabled`. Adding a further provider means adding one more case in
// getProvider() — the interface (generate(prompt, options)) doesn't change.
//
// 'groq' (cloud, Llama 3.1 8B Instant, free tier) is the default/primary
// provider for the chat assistant (summarize/translate/rewrite/smart-reply/
// title/topics — see ai/policy.js). 'ollama' (local, self-hosted) remains for
// the separate Security AI subsystem (services/securityAi/), which has its
// own AI_SECURITY_ENABLED flag and different privacy reasoning — this file
// just hosts both adapters behind the same interface.

const disabledProvider = {
  enabled: false,
  async generate() {
    throw new Error('AI features are disabled (AI_PROVIDER is not set).');
  },
  async transcribe() {
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
  // Ollama has no bundled speech-to-text endpoint in this codebase's
  // integration — Meeting AI (Phase 14) requires AI_PROVIDER=groq
  // specifically for transcription, even if AI_PROVIDER=ollama is used for
  // text features. Fails closed with a clear reason rather than silently
  // no-op-ing.
  async transcribe() {
    throw new Error('Transcription is not supported by the ollama provider — set AI_PROVIDER=groq for Meeting AI.');
  },
});

// Groq's Chat Completions endpoint is OpenAI-compatible — one message array,
// one model string, no separate SDK needed (native fetch, same as
// buildOllamaProvider above; no new dependency for what one HTTP call does).
const buildGroqProvider = (config) => ({
  enabled: true,
  async generate(prompt, options = {}) {
    const maxTokens = options.maxTokens || config.maxOutputTokens || 800;
    const res = await fetch(`${config.baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || config.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.3,
        ...(options.format === 'json' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: options.signal,
    });

    if (res.status === 429) {
      const err = new Error('Groq rate limit exceeded');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Groq request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  },

  // Meeting AI (Phase 14) — Groq's Whisper transcription endpoint, same
  // account/API key as the chat model, no separate STT dependency. Takes a
  // raw audio Buffer (already downloaded from object storage by the caller
  // — see ai/meetingTranscriptService.js) and returns plain transcript text.
  async transcribe(audioBuffer, filename, options = {}) {
    const form = new FormData();
    form.append('file', new Blob([audioBuffer]), filename);
    form.append('model', options.model || 'whisper-large-v3-turbo');
    form.append('response_format', 'text');

    const res = await fetch(`${config.baseUrl}/openai/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: options.signal,
    });

    if (res.status === 429) {
      const err = new Error('Groq rate limit exceeded');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Groq transcription failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  },
});

const getProvider = (config) => {
  if (config.aiProvider === 'groq') {
    if (!config.groqApiKey) return disabledProvider; // fails closed, not open — a misconfigured deploy (flag on, key missing) behaves exactly like AI_PROVIDER=none, never a crash
    return buildGroqProvider({
      apiKey: config.groqApiKey, model: config.groqModel, maxOutputTokens: config.aiMaxOutputTokens, baseUrl: config.groqBaseUrl || 'https://api.groq.com',
    });
  }
  if (config.aiProvider === 'ollama') {
    return buildOllamaProvider({ url: config.ollamaUrl, model: config.ollamaModel });
  }
  return disabledProvider;
};

module.exports = { getProvider };
