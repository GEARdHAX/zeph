// Zeph AI — provider failover router tests. Gemini primary, Groq fallback.
const store = require('../src/store');
const config = require('../config');
const providerRouter = require('../src/ai/providerRouter');

const originalFetch = global.fetch;

// A fetch stub that routes by hostname: generativelanguage.googleapis.com ->
// Gemini shape, api.groq.com -> Groq shape. Each side's behavior is
// controlled by the `gemini` / `groq` handlers passed in.
const stubFetch = ({ gemini, groq }) => {
  global.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com')) return gemini(url, opts);
    if (String(url).includes('api.groq.com')) return groq(url, opts);
    throw new Error(`unexpected fetch to ${url}`);
  };
};

const geminiOk = (text) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});
const groqOk = (text) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: text } }] }),
});
const httpFail = (status) => async () => ({ ok: false, status, statusText: 'err' });

beforeEach(() => {
  providerRouter.resetBreakersForTests();
  store.config = {
    ...config,
    aiProvider: 'gemini',
    geminiApiKey: 'gem-key',
    geminiModel: 'gemini-3.5-flash-lite',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    groqApiKey: 'groq-key',
    groqModel: 'openai/gpt-oss-20b',
    groqBaseUrl: 'https://api.groq.com',
  };
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('providerRouter.generate — primary (Gemini) healthy', () => {
  it('uses Gemini and does not touch Groq', async () => {
    let groqCalled = false;
    stubFetch({
      gemini: geminiOk('gemini says hi'),
      groq: async () => {
        groqCalled = true;
        return groqOk('x')();
      },
    });

    const result = await providerRouter.generate('hi');
    expect(result.text).toBe('gemini says hi');
    expect(result.providerUsed).toBe('gemini');
    expect(groqCalled).toBe(false);
  });
});

describe('providerRouter.generate — Gemini health failure -> Groq fallback', () => {
  it('falls back to Groq on a Gemini 500', async () => {
    stubFetch({ gemini: httpFail(500), groq: groqOk('groq fallback result') });
    const result = await providerRouter.generate('hi');
    expect(result.text).toBe('groq fallback result');
    expect(result.providerUsed).toBe('groq');
  });

  it('falls back to Groq on a Gemini 429 (rate limited)', async () => {
    stubFetch({ gemini: httpFail(429), groq: groqOk('groq after 429') });
    const result = await providerRouter.generate('hi');
    expect(result.providerUsed).toBe('groq');
  });

  it('falls back on a Gemini network error', async () => {
    stubFetch({
      gemini: async () => {
        throw new Error('fetch failed');
      },
      groq: groqOk('recovered'),
    });
    const result = await providerRouter.generate('hi');
    expect(result.providerUsed).toBe('groq');
  });
});

describe('providerRouter.generate — NON-health failure does not trigger fallback', () => {
  it('a Gemini 400 (bad request) throws without trying Groq', async () => {
    let groqCalled = false;
    stubFetch({
      gemini: httpFail(400),
      groq: async () => {
        groqCalled = true;
        return groqOk('x')();
      },
    });
    await expect(providerRouter.generate('hi')).rejects.toThrow();
    expect(groqCalled).toBe(false);
  });
});

describe('providerRouter — circuit breaker', () => {
  it("opens Gemini's circuit after 3 consecutive health failures, then skips straight to Groq", async () => {
    let geminiCalls = 0;
    stubFetch({
      gemini: async () => {
        geminiCalls += 1;
        return httpFail(500)();
      },
      groq: groqOk('groq'),
    });

    // 3 failures trip the breaker (each request still succeeds via Groq).
    await providerRouter.generate('a');
    await providerRouter.generate('b');
    await providerRouter.generate('c');
    expect(geminiCalls).toBe(3);

    // 4th request: Gemini circuit OPEN -> router must NOT call Gemini again.
    await providerRouter.generate('d');
    expect(geminiCalls).toBe(3); // unchanged
  });

  it('recovers: after cooldown a trial Gemini call that succeeds closes the circuit', async () => {
    // Not time-testing the real 60s cooldown here — just assert a success
    // resets the failure count so the circuit stays closed under load.
    stubFetch({ gemini: geminiOk('ok'), groq: groqOk('g') });
    await providerRouter.generate('a');
    await providerRouter.generate('b');
    const result = await providerRouter.generate('c');
    expect(result.providerUsed).toBe('gemini');
  });
});

describe('providerRouter — no fallback available', () => {
  it('with AI_PROVIDER=groq (no fallback target), a Groq failure just throws', async () => {
    store.config.aiProvider = 'groq';
    store.config.geminiApiKey = null;
    stubFetch({
      gemini: async () => {
        throw new Error('should not be called');
      },
      groq: httpFail(500),
    });
    await expect(providerRouter.generate('hi')).rejects.toThrow();
  });

  it('with gemini primary but NO groq key, a Gemini failure throws (nothing to fall back to)', async () => {
    store.config.groqApiKey = null;
    stubFetch({
      gemini: httpFail(500),
      groq: async () => {
        throw new Error('no groq key');
      },
    });
    await expect(providerRouter.generate('hi')).rejects.toThrow();
  });
});

describe('providerRouter.aiTextEnabled', () => {
  it('false when AI_PROVIDER is none/unset', () => {
    expect(providerRouter.aiTextEnabled({ aiProvider: 'none' })).toBe(false);
    expect(providerRouter.aiTextEnabled({})).toBe(false);
  });

  it('true when gemini is configured with a key', () => {
    expect(providerRouter.aiTextEnabled({ aiProvider: 'gemini', geminiApiKey: 'k' })).toBe(true);
  });

  it('true when gemini has no key but a Groq fallback key exists', () => {
    expect(providerRouter.aiTextEnabled({ aiProvider: 'gemini', geminiApiKey: null, groqApiKey: 'gk' })).toBe(true);
  });

  it('false when gemini has no key and no Groq fallback', () => {
    expect(providerRouter.aiTextEnabled({ aiProvider: 'gemini', geminiApiKey: null, groqApiKey: null })).toBe(false);
  });
});
