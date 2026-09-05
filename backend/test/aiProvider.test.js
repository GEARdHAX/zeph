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

describe('getProvider — groq, configured', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

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

  it('never includes the API key in the request body (only the Authorization header)', async () => {
    let capturedHeaders;
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      capturedBody = opts.body;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    const provider = getProvider({ aiProvider: 'groq', groqApiKey: 'super-secret-key', groqModel: 'llama-3.1-8b-instant' });
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
  afterEach(() => { global.fetch = originalFetch; });

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
    const provider = getProvider({ aiProvider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'llama3.2:1b' });
    await expect(provider.transcribe(Buffer.from('audio'), 'a.webm')).rejects.toThrow(/not supported/);
  });
});
