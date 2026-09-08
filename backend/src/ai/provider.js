// AI provider abstraction (Zeph AI, Phase 2): Chat → this service → a provider
// implementation, or a disabled no-op if AI_PROVIDER is unset. Callers never
// branch on whether AI is configured — they just call the interface and check
// `.enabled`. Adding a further provider means adding one more case in
// getProvider() — the interface (generate(prompt, options)) doesn't change.
//
// Providers:
//   'gemini' — Google Gemini (gemini-3.5-flash-lite by default), PRIMARY
//              text provider for the chat assistant. Also transcribes (its
//              multimodal model takes audio directly, no separate STT call).
//   'groq'   — Groq (openai/gpt-oss-20b), FALLBACK text provider + the
//              Whisper STT path. AI_PROVIDER=groq uses it as primary.
//   'ollama' — local, self-hosted; used only by the separate Security AI
//              subsystem (services/securityAi/), its own AI_SECURITY_ENABLED
//              flag, different privacy reasoning.
//
// When AI_PROVIDER=gemini AND a Groq key is also configured, ai/gateway.js
// routes through ai/providerRouter.js which tries Gemini first and falls
// back to Groq on a provider-health failure (timeout/5xx/429/network) —
// NOT on a bad-output failure, which isn't a health problem. See that file.

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
//
// The default free-tier model (openai/gpt-oss-20b) is a REASONING model: it
// spends ~100-200 tokens on hidden reasoning (in a separate `reasoning`
// field, not `content`) BEFORE writing any visible answer, and that
// reasoning counts against max_tokens. A caller asking for a 30-token title
// would get an empty `content` (finish_reason:"length") — which
// outputValidation.js then rejects as INVALID_OUTPUT. Two guards below fix
// this without every route needing to know the model is a reasoner:
//   1. MIN_MAX_TOKENS floor — no request is ever sent with a budget too
//      small for the model to produce anything.
//   2. reasoning_effort: "low" — cuts the reasoning overhead, but Groq
//      REJECTS this param on non-reasoning models ("`reasoning_effort` is
//      not supported with this model"), so it's only sent when the model id
//      is a known reasoner.
const MIN_MAX_TOKENS = 512;
const isReasoningModel = (model) => /gpt-oss|qwen3/i.test(model || '');

const buildGroqProvider = (config) => ({
  enabled: true,
  async generate(prompt, options = {}) {
    const model = options.model || config.model;
    const requestedMax = options.maxTokens || config.maxOutputTokens || 800;
    const maxTokens = Math.max(requestedMax, MIN_MAX_TOKENS);
    const res = await fetch(`${config.baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0.3,
        ...(isReasoningModel(model) ? { reasoning_effort: 'low' } : {}),
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

// Google Gemini — `generateContent` REST endpoint (not OpenAI-shaped: the
// prompt goes in `contents[].parts[].text`, generation params in
// `generationConfig`, and the response text is
// `candidates[0].content.parts[0].text`). Native fetch, no SDK — same as the
// other adapters. Gemini's non-lite/lite Flash models are NOT reasoning
// models in the gpt-oss sense (no hidden reasoning eating the token budget),
// so no MIN_MAX_TOKENS floor is needed here.
const buildGeminiProvider = (config) => ({
  enabled: true,
  provider: 'gemini',
  async generate(prompt, options = {}) {
    const model = options.model || config.model;
    const maxOutputTokens = options.maxTokens || config.maxOutputTokens || 800;
    const url = `${config.baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens,
          temperature: options.temperature ?? 0.3,
          ...(options.format === 'json' ? { responseMimeType: 'application/json' } : {}),
        },
      }),
      signal: options.signal,
    });

    if (res.status === 429) {
      const err = new Error('Gemini rate limit exceeded');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Gemini request failed: ${res.status} ${res.statusText}`);
      if (res.status >= 500) err.code = 'SERVER_ERROR';
      throw err;
    }

    const data = await res.json();
    // A safety block returns 200 with no candidates / a promptFeedback block
    // reason — treat as an empty response, which outputValidation.js rejects.
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  },

  // Meeting transcription — uses the DEDICATED gemini-3.5-transcribe model
  // (config.transcribeModel), not the text model. It's purpose-built STT:
  // more accurate, retains speaker labels when the audio has them, and its
  // response comes back as parts[].audioTranscription.text (a different
  // shape from generate()'s parts[].text). Groq Whisper
  // (buildGroqProvider.transcribe) is the fallback path —
  // meetingTranscriptService.js picks per config.
  async transcribe(audioBuffer, filename, options = {}) {
    const model = options.model || config.transcribeModel || 'gemini-3.5-transcribe';
    const lower = (filename || '').toLowerCase();
    const mimeType = lower.endsWith('.mp3')
      ? 'audio/mp3'
      : lower.endsWith('.wav')
        ? 'audio/wav'
        : lower.endsWith('.m4a')
          ? 'audio/mp4'
          : lower.endsWith('.ogg') || lower.endsWith('.opus')
            ? 'audio/ogg'
            : 'audio/webm';
    const url = `${config.baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'Transcribe this meeting audio. Include speaker labels if distinguishable.' },
              { inlineData: { mimeType, data: audioBuffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
      signal: options.signal,
    });

    if (res.status === 429) {
      const err = new Error('Gemini rate limit exceeded');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Gemini transcription failed: ${res.status} ${res.statusText}`);
      if (res.status >= 500) err.code = 'SERVER_ERROR';
      throw err;
    }
    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.[0] ?? {};
    // gemini-3.5-transcribe returns { audioTranscription: { text } }; the
    // generic text model would return { text }. Support both so a future
    // config pointing transcribeModel at a multimodal text model still works.
    return part.audioTranscription?.text ?? part.text ?? '';
  },
});

// Returns the single provider for `config.aiProvider`, or disabledProvider.
// This is what securityAi and the route-level `.enabled` guards use. The
// chat-assistant failover path uses getTextProvider() below instead.
const getProvider = (config) => {
  if (config.aiProvider === 'gemini') {
    if (!config.geminiApiKey) return disabledProvider;
    return buildGeminiProvider({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      transcribeModel: config.geminiTranscribeModel,
      maxOutputTokens: config.aiMaxOutputTokens,
      baseUrl: config.geminiBaseUrl || 'https://generativelanguage.googleapis.com',
    });
  }
  if (config.aiProvider === 'groq') {
    if (!config.groqApiKey) return disabledProvider; // fails closed, not open — a misconfigured deploy (flag on, key missing) behaves exactly like AI_PROVIDER=none, never a crash
    return buildGroqProvider({
      apiKey: config.groqApiKey,
      model: config.groqModel,
      maxOutputTokens: config.aiMaxOutputTokens,
      baseUrl: config.groqBaseUrl || 'https://api.groq.com',
    });
  }
  if (config.aiProvider === 'ollama') {
    return buildOllamaProvider({ url: config.ollamaUrl, model: config.ollamaModel });
  }
  return disabledProvider;
};

// Builds a Groq adapter directly (bypassing config.aiProvider), used by
// providerRouter.js as the fallback when the primary is Gemini. Returns
// null when no Groq key is set — the router then has no fallback and a
// primary failure surfaces to the user (still better than a crash).
const buildGroqFallback = (config) => {
  if (!config.groqApiKey) return null;
  return buildGroqProvider({
    apiKey: config.groqApiKey,
    model: config.groqModel,
    maxOutputTokens: config.aiMaxOutputTokens,
    baseUrl: config.groqBaseUrl || 'https://api.groq.com',
  });
};

module.exports = { getProvider, buildGroqFallback };
