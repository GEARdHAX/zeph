const Uploader = require('../src/uploader');

const silentLogger = { error: () => {}, warn: () => {} };

describe('Uploader.sendOnce', () => {
  it('returns ok:true on a 200 response', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    const result = await uploader.sendOnce([{ eventId: '1' }]);
    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith('http://x', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-zeph-sensor-id': 's', 'x-zeph-sensor-credential': 'c' }),
    }));
  });

  it('treats 401 as non-retryable (bad credential — retrying changes nothing)', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    const result = await uploader.sendOnce([]);
    expect(result).toEqual({ ok: false, retryable: false });
  });

  it('treats 429 as retryable', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendOnce([])).toEqual({ ok: false, retryable: true });
  });

  it('treats 5xx as retryable', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendOnce([])).toEqual({ ok: false, retryable: true });
  });

  it('treats 400 as non-retryable (malformed request — retrying the same batch can never succeed)', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 400 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendOnce([])).toEqual({ ok: false, retryable: false });
  });

  it('a network error (fetch throws) is retryable', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendOnce([])).toEqual({ ok: false, retryable: true });
  });
});

describe('Uploader.sendWithRetry', () => {
  it('succeeds immediately if the first attempt succeeds', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendWithRetry([])).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops immediately on a non-retryable failure, without exhausting retries', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendWithRetry([])).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and eventually succeeds', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendWithRetry([])).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }, 10000);

  it('gives up (returns false) after exhausting MAX_RETRIES of persistent retryable failures', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const uploader = new Uploader({
      apiUrl: 'http://x', sensorId: 's', credential: 'c', fetchFn, logger: silentLogger,
    });
    expect(await uploader.sendWithRetry([])).toBe(false);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1); // bounded retries actually happened
  }, 30000);
});
