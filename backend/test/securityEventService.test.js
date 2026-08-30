const db = require('./helpers/db');
const SecurityEvent = require('../src/models/SecurityEvent');
const SecurityEventService = require('../src/services/securityEventService');
const logger = require('../src/logger');

// record() writes to Mongo asynchronously without the caller awaiting it —
// tests need a short wait for that write to settle before asserting on it,
// and afterEach needs the same wait before clearDatabase() so a slow test's
// pending write can never bleed into the next test's assertions.
const flush = () => new Promise((resolve) => { setTimeout(resolve, 50); });

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

afterEach(async () => {
  await flush();
  await db.clearDatabase();
  jest.restoreAllMocks();
});

describe('SecurityEventService.record — event creation', () => {
  it('persists a well-formed event with all fields normalized', async () => {
    const eventId = SecurityEventService.record({
      type: 'LOGIN_SUCCESS',
      severity: 'low',
      actor: { userId: 'user-1', sessionId: 'session-1' },
      source: { ip: '1.2.3.4', userAgent: 'test-agent', deviceId: 'device-1' },
      target: { resource: '/api/login', resourceId: null, action: 'login' },
      result: 'success',
      metadata: { note: 'ok' },
      requestId: 'req-1',
    });
    expect(eventId).toBeDefined();
    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved).not.toBeNull();
    expect(saved.type).toBe('LOGIN_SUCCESS');
    expect(saved.actor.userId).toBe('user-1');
    expect(saved.source.ip).toBe('1.2.3.4');
    expect(saved.result).toBe('success');
    expect(saved.requestId).toBe('req-1');
    expect(saved.sourceSystem).toBe('app');
    expect(saved.metadata.note).toBe('ok');
  });

  it('defaults severity/result/sourceSystem when omitted', async () => {
    const eventId = SecurityEventService.record({ type: 'LOGOUT', actor: { userId: 'user-2' } });
    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.severity).toBe('low');
    expect(saved.result).toBe('unknown');
    expect(saved.sourceSystem).toBe('app');
  });

  it('generates a unique eventId per call', async () => {
    const a = SecurityEventService.record({ type: 'LOGOUT' });
    const b = SecurityEventService.record({ type: 'LOGOUT' });
    expect(a).not.toBe(b);
  });
});

describe('SecurityEventService.record — validation', () => {
  it('rejects an unknown event type and persists nothing', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const result = SecurityEventService.record({ type: 'NOT_A_REAL_EVENT_TYPE' });
    expect(result).toBeUndefined();
    await flush();

    expect(await SecurityEvent.countDocuments()).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NOT_A_REAL_EVENT_TYPE' }),
      'security_event_rejected_invalid_type',
    );
  });

  it('rejects an invalid severity and persists nothing', async () => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    SecurityEventService.record({ type: 'LOGIN_SUCCESS', severity: 'apocalyptic' });
    await flush();
    expect(await SecurityEvent.countDocuments()).toBe(0);
  });

  it('rejects an invalid result and persists nothing', async () => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    SecurityEventService.record({ type: 'LOGIN_SUCCESS', result: 'maybe' });
    await flush();
    expect(await SecurityEvent.countDocuments()).toBe(0);
  });

  it('handles a missing/empty event object without throwing', () => {
    expect(() => SecurityEventService.record()).not.toThrow();
    expect(() => SecurityEventService.record({})).not.toThrow();
  });
});

describe('SecurityEventService — sensitive-data sanitization', () => {
  const FORBIDDEN_SAMPLES = {
    password: 'hunter2',
    newPassword: 'hunter3',
    token: 'eyJhbGciOiJIUzI1NiJ9.abc.def',
    accessToken: 'abc.def.ghi',
    refreshToken: 'refresh-xyz',
    jwt: 'abc.def.ghi',
    otp: '123456',
    authCode: '654321',
    secret: 'shh',
    apiKey: 'sk-abcdef',
    content: 'this is a private message',
    messageContent: 'another private message',
  };

  it('redacts every forbidden key at the top level of metadata', () => {
    const sanitized = SecurityEventService.sanitizeMetadata(FORBIDDEN_SAMPLES);
    Object.keys(FORBIDDEN_SAMPLES).forEach((key) => {
      expect(sanitized[key]).toBe('[redacted]');
    });
  });

  it('redacts forbidden keys nested arbitrarily deep', () => {
    const sanitized = SecurityEventService.sanitizeMetadata({
      wrapper: { inner: { password: 'hunter2', safe: 'keep-me' } },
    });
    expect(sanitized.wrapper.inner.password).toBe('[redacted]');
    expect(sanitized.wrapper.inner.safe).toBe('keep-me');
  });

  it('redacts forbidden keys inside arrays of objects', () => {
    const sanitized = SecurityEventService.sanitizeMetadata({
      items: [{ token: 'abc' }, { safe: 'ok' }],
    });
    expect(sanitized.items[0].token).toBe('[redacted]');
    expect(sanitized.items[1].safe).toBe('ok');
  });

  it('leaves harmless metadata untouched', () => {
    const sanitized = SecurityEventService.sanitizeMetadata({ reason: 'FILE_TOO_LARGE', size: 12345 });
    expect(sanitized).toEqual({ reason: 'FILE_TOO_LARGE', size: 12345 });
  });

  it('never persists a forbidden key value end-to-end through record()', async () => {
    const eventId = SecurityEventService.record({
      type: 'LOGIN_FAILED',
      metadata: { password: 'hunter2', reason: 'bad_credentials' },
    });
    await flush();

    const saved = await SecurityEvent.findOne({ eventId });
    expect(saved.metadata.password).toBe('[redacted]');
    expect(saved.metadata.reason).toBe('bad_credentials');
    expect(JSON.stringify(saved.metadata)).not.toContain('hunter2');
  });

  it('caps recursion depth instead of stack-overflowing on pathological input', () => {
    let deep = { password: 'leaf' };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => SecurityEventService.sanitizeMetadata(deep)).not.toThrow();
  });
});

describe('SecurityEventService — failure handling', () => {
  it('logs but does not throw when the Mongo write fails', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(SecurityEvent, 'create').mockRejectedValueOnce(new Error('mongo down'));

    expect(() => SecurityEventService.record({ type: 'LOGIN_SUCCESS' })).not.toThrow();
    await flush();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'security_event_persist_failed',
    );
  });

  it('still logs the structured Pino line even when Mongo is unavailable', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(SecurityEvent, 'create').mockRejectedValueOnce(new Error('mongo down'));

    SecurityEventService.record({ type: 'LOGIN_SUCCESS', actor: { userId: 'user-3' } });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'LOGIN_SUCCESS', userId: 'user-3' }),
      'security_event',
    );
  });
});
