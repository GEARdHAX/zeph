const { getProvider } = require('../src/ai/provider');

describe('getProvider — disabled (AI_PROVIDER unset/none)', () => {
  it('returns a disabled provider that throws on generate', async () => {
    const provider = getProvider({ aiProvider: 'none' });
    expect(provider.enabled).toBe(false);
    await expect(provider.generate('x')).rejects.toThrow();
  });
});

describe('getProvider — groq, missing API key fails closed', () => {
  it('returns a disabled provider when GROQ_API_KEY is not set', () => {
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: null });
    expect(provider.enabled).toBe(false);
  });
});

describe('getProvider — gemini', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fails closed with no GEMINI_API_KEY', () => {
    const provider = getProvider({ aiProvider: 'gemini', geminiApiKey: null });
    expect(provider.enabled).toBe(false);
  });

  it('calls generateContent with the prompt in contents[].parts[].text and returns the response text', async () => {
    let capturedUrl;
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }] }),
      };
    };
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiModel: 'gemini-3.5-flash-lite',
      geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    });
    const result = await provider.generate('say hi');
    expect(result).toBe('gemini reply');
    expect(capturedUrl).toContain('gemini-3.5-flash-lite:generateContent');
    expect(capturedUrl).toContain('key=gk');
    expect(capturedBody.contents[0].parts[0].text).toBe('say hi');
  });

  it('the API key goes only in the query string, never a header or body field', async () => {
    let capturedHeaders;
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      capturedBody = opts.body;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) };
    };
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'super-secret',
      geminiModel: 'm',
      geminiBaseUrl: 'https://x',
    });
    await provider.generate('hi');
    expect(JSON.stringify(capturedHeaders || {})).not.toContain('super-secret');
    expect(capturedBody).not.toContain('super-secret');
  });

  it('throws a RATE_LIMITED-coded error on 429', async () => {
    global.fetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' });
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiModel: 'm',
      geminiBaseUrl: 'https://x',
    });
    await expect(provider.generate('hi')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('throws a SERVER_ERROR-coded error on 5xx (so the router treats it as a health failure)', async () => {
    global.fetch = async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiModel: 'm',
      geminiBaseUrl: 'https://x',
    });
    await expect(provider.generate('hi')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('returns empty string on a safety-blocked response (no candidates) — outputValidation then rejects it', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    });
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiModel: 'm',
      geminiBaseUrl: 'https://x',
    });
    expect(await provider.generate('hi')).toBe('');
  });

  it('transcribe() uses the DEDICATED transcribe model, not the text model', async () => {
    let capturedUrl;
    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ audioTranscription: { text: 't' } }] } }] }),
      };
    };
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiModel: 'gemini-3.5-flash-lite',
      geminiTranscribeModel: 'gemini-3.5-transcribe',
      geminiBaseUrl: 'https://x',
    });
    await provider.transcribe(Buffer.from('audio'), 'meeting.webm');
    expect(capturedUrl).toContain('gemini-3.5-transcribe:generateContent');
    expect(capturedUrl).not.toContain('flash-lite');
  });

  it('transcribe() reads the audioTranscription.text response shape (dedicated STT model)', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ audioTranscription: { text: 'Alice: hello. Bob: hi.' } }] } }],
      }),
    });
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiTranscribeModel: 'gemini-3.5-transcribe',
      geminiBaseUrl: 'https://x',
    });
    expect(await provider.transcribe(Buffer.from('a'), 'x.wav')).toBe('Alice: hello. Bob: hi.');
  });

  it('transcribe() also accepts the plain parts[].text shape (fallback for a text model)', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'plain transcript' }] } }] }),
    });
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiTranscribeModel: 'm',
      geminiBaseUrl: 'https://x',
    });
    expect(await provider.transcribe(Buffer.from('a'), 'x.wav')).toBe('plain transcript');
  });

  it('transcribe() sends inline base64 audio with the right mime type', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ audioTranscription: { text: 't' } }] } }] }),
      };
    };
    const provider = getProvider({
      aiProvider: 'gemini',
      geminiApiKey: 'gk',
      geminiTranscribeModel: 'm',
      geminiBaseUrl: 'https://x',
    });
    await provider.transcribe(Buffer.from('fake audio'), 'meeting.wav');
    const audioPart = capturedBody.contents[0].parts.find((p) => p.inlineData);
    expect(audioPart.inlineData.mimeType).toBe('audio/wav');
    expect(audioPart.inlineData.data).toBe(Buffer.from('fake audio').toString('base64'));
  });
});

describe('getProvider — groq, configured', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls Groq chat completions and returns the message content', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'hello there' } }] }),
      };
    };
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'test-key', groqModel: 'llama-3.1-8b-instant' });
    const result = await provider.generate('say hi');
    expect(result).toBe('hello there');
    expect(capturedBody.model).toBe('llama-3.1-8b-instant');
    expect(capturedBody.messages[0].content).toBe('say hi');
  });

  it('enforces a minimum max_tokens floor (reasoning models starve at a tiny budget)', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'k', groqModel: 'openai/gpt-oss-20b' });
    await provider.generate('title please', { maxTokens: 30 });
    expect(capturedBody.max_tokens).toBeGreaterThanOrEqual(512);
  });

  it('sends reasoning_effort:low for a reasoning model (gpt-oss / qwen3)', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'k', groqModel: 'openai/gpt-oss-20b' });
    await provider.generate('hi');
    expect(capturedBody.reasoning_effort).toBe('low');
  });

  it('does NOT send reasoning_effort for a non-reasoning model (Groq rejects the param there)', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'k', groqModel: 'allam-2-7b' });
    await provider.generate('hi');
    expect(capturedBody.reasoning_effort).toBeUndefined();
  });

  it('never includes the API key in the request body (only the Authorization header)', async () => {
    let capturedHeaders;
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      capturedBody = opts.body;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    const provider = getProvider({
      aiProvider: 'groq',
      groqApiKey: 'super-secret-key',
      groqModel: 'llama-3.1-8b-instant',
    });
    await provider.generate('hi');
    expect(capturedHeaders.Authorization).toBe('Bearer super-secret-key');
    expect(capturedBody).not.toContain('super-secret-key');
  });

  it('throws a RATE_LIMITED-coded error on HTTP 429', async () => {
    global.fetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' });
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'test-key', groqModel: 'llama-3.1-8b-instant' });
    await expect(provider.generate('hi')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('throws on other HTTP failures', async () => {
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'test-key', groqModel: 'llama-3.1-8b-instant' });
    await expect(provider.generate('hi')).rejects.toThrow();
  });
});

describe('getProvider — groq transcribe() (Meeting AI, Phase 14)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts multipart form data to the Whisper endpoint and returns plain text', async () => {
    let capturedUrl;
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = opts.body;
      return { ok: true, status: 200, text: async () => 'this is the transcript' };
    };
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'test-key' });
    const result = await provider.transcribe(Buffer.from('fake audio'), 'meeting.webm');

    expect(result).toBe('this is the transcript');
    expect(capturedUrl).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(capturedBody).toBeInstanceOf(FormData);
  });

  it('never puts the API key anywhere but the Authorization header', async () => {
    let capturedHeaders;
    global.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, status: 200, text: async () => 'transcript' };
    };
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'super-secret-key' });
    await provider.transcribe(Buffer.from('audio'), 'a.webm');
    expect(capturedHeaders.Authorization).toBe('Bearer super-secret-key');
  });

  it('throws a RATE_LIMITED-coded error on HTTP 429', async () => {
    global.fetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' });
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'test-key' });
    await expect(provider.transcribe(Buffer.from('audio'), 'a.webm')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('throws on other HTTP failures', async () => {
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'test-key' });
    await expect(provider.transcribe(Buffer.from('audio'), 'a.webm')).rejects.toThrow();
  });
});

describe('getProvider — ollama transcribe() is unsupported', () => {
  it('throws a clear error rather than silently no-op-ing', async () => {
    const provider = getProvider({
      aiProvider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.2:1b',
    });
    await expect(provider.transcribe(Buffer.from('audio'), 'a.webm')).rejects.toThrow(/not supported/);
  });
});
