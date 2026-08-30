const { validateSensorEvent, MAX_EVENTS_PER_BATCH, MAX_EVENT_JSON_BYTES } = require('../src/services/ebpf/sensorEventValidation');

const validProcessEvent = () => ({
  eventId: 'evt-1',
  type: 'PROCESS_EXEC',
  timestamp: new Date().toISOString(),
  process: { name: 'sshd', pid: 1234, parentPid: 1, parentName: 'systemd' },
});

const validNetworkEvent = () => ({
  eventId: 'evt-2',
  type: 'NETWORK_CONNECTION',
  timestamp: new Date().toISOString(),
  network: { destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'tcp' },
});

describe('sensorEventValidation', () => {
  it('accepts a well-formed PROCESS_EXEC event', () => {
    const result = validateSensorEvent(validProcessEvent());
    expect(result.ok).toBe(true);
    expect(result.event.process).toEqual({
      name: 'sshd', pid: 1234, parentPid: 1, parentName: 'systemd',
    });
  });

  it('accepts a well-formed NETWORK_CONNECTION event and uppercases protocol', () => {
    const result = validateSensorEvent(validNetworkEvent());
    expect(result.ok).toBe(true);
    expect(result.event.network.protocol).toBe('TCP');
  });

  it('rejects a non-object payload', () => {
    expect(validateSensorEvent(null).ok).toBe(false);
    expect(validateSensorEvent('nope').ok).toBe(false);
  });

  it('rejects an unsupported type', () => {
    const result = validateSensorEvent({ ...validProcessEvent(), type: 'LOGIN_FAILED' });
    expect(result).toEqual({ ok: false, reason: 'unsupported_type' });
  });

  it('rejects missing/invalid eventId', () => {
    const event = validProcessEvent();
    delete event.eventId;
    expect(validateSensorEvent(event)).toEqual({ ok: false, reason: 'missing_event_id' });
  });

  it('rejects an invalid timestamp', () => {
    const result = validateSensorEvent({ ...validProcessEvent(), timestamp: 'not-a-date' });
    expect(result).toEqual({ ok: false, reason: 'invalid_timestamp' });
  });

  it('rejects a PROCESS_EXEC event with no process data', () => {
    const event = validProcessEvent();
    delete event.process;
    expect(validateSensorEvent(event)).toEqual({ ok: false, reason: 'missing_process_data' });
  });

  it('rejects a NETWORK_CONNECTION event with no network data', () => {
    const event = validNetworkEvent();
    delete event.network;
    expect(validateSensorEvent(event)).toEqual({ ok: false, reason: 'missing_network_data' });
  });

  it('rejects an oversized event payload', () => {
    const event = { ...validProcessEvent(), process: { name: 'a'.repeat(MAX_EVENT_JSON_BYTES) } };
    expect(validateSensorEvent(event)).toEqual({ ok: false, reason: 'event_too_large' });
  });

  it('silently drops sensor-provided severity/riskScore/decision/malicious/trusted/policy — never persists them', () => {
    const event = {
      ...validProcessEvent(),
      severity: 'critical',
      riskScore: 100,
      decision: 'DENY',
      malicious: true,
      trusted: false,
      policy: 'ADMIN_OVERRIDE',
    };
    const result = validateSensorEvent(event);
    expect(result.ok).toBe(true);
    const persisted = JSON.stringify(result.event);
    expect(persisted).not.toMatch(/critical|DENY|ADMIN_OVERRIDE/);
    expect(result.event.severity).toBeUndefined();
    expect(result.event.riskScore).toBeUndefined();
    expect(result.event.decision).toBeUndefined();
    expect(result.event.malicious).toBeUndefined();
    expect(result.event.trusted).toBeUndefined();
    expect(result.event.policy).toBeUndefined();
  });

  it('ignores non-integer/out-of-range pid and port fields rather than accepting them', () => {
    const event = {
      ...validProcessEvent(),
      process: {
        name: 'x', pid: -1, parentPid: 'nope', parentName: 'y',
      },
    };
    const result = validateSensorEvent(event);
    expect(result.ok).toBe(true);
    expect(result.event.process).toEqual({ name: 'x', parentName: 'y' });
  });

  it('exposes a sane MAX_EVENTS_PER_BATCH bound', () => {
    expect(MAX_EVENTS_PER_BATCH).toBeGreaterThan(0);
    expect(MAX_EVENTS_PER_BATCH).toBeLessThanOrEqual(1000);
  });
});
