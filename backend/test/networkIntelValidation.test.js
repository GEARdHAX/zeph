const { validateSensorEvent, sanitizeFlow, sanitizeDns } = require('../src/services/ebpf/sensorEventValidation');

const validFlowEvent = (overrides = {}) => ({
  eventId: 'flow-1',
  type: 'NETWORK_FLOW',
  timestamp: new Date().toISOString(),
  flow: {
    destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'TCP', direction: 'OUTBOUND', bytesSent: 1024, bytesReceived: 4096, durationMs: 1200, pid: 100, processName: 'node',
  },
  ...overrides,
});

const validDnsEvent = (overrides = {}) => ({
  eventId: 'dns-1',
  type: 'DNS_QUERY',
  timestamp: new Date().toISOString(),
  dns: { domain: 'example.com', queryType: 'A', pid: 100, processName: 'node' },
  ...overrides,
});

describe('sanitizeFlow', () => {
  it('accepts a well-formed flow', () => {
    const out = sanitizeFlow({
      destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'tcp', bytesSent: 10, bytesReceived: 20, durationMs: 5, direction: 'OUTBOUND', pid: 1, processName: 'x',
    });
    expect(out).toEqual({
      destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'TCP', direction: 'OUTBOUND', bytesSent: 10, bytesReceived: 20, durationMs: 5, pid: 1, processName: 'x',
    });
  });

  it('accepts IPv6 destinations (validator.isIP handles both — spec section 37)', () => {
    const out = sanitizeFlow({ destinationIp: '2001:db8::1', destinationPort: 443, protocol: 'TCP' });
    expect(out.destinationIp).toBe('2001:db8::1');
  });

  it('rejects a missing/invalid destinationIp', () => {
    expect(sanitizeFlow({ destinationIp: 'not-an-ip', destinationPort: 443, protocol: 'TCP' })).toBeNull();
    expect(sanitizeFlow({ destinationPort: 443, protocol: 'TCP' })).toBeNull();
  });

  it('rejects an invalid protocol', () => {
    expect(sanitizeFlow({ destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'ICMP' })).toBeNull();
  });

  it('rejects an out-of-range port', () => {
    expect(sanitizeFlow({ destinationIp: '203.0.113.5', destinationPort: 70000, protocol: 'TCP' })).toBeNull();
  });

  it('drops an invalid direction rather than accepting an arbitrary string', () => {
    const out = sanitizeFlow({
      destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'TCP', direction: 'SIDEWAYS',
    });
    expect(out.direction).toBeUndefined();
  });

  it('never surfaces sensor-provided riskScore/malicious/decision fields', () => {
    const out = sanitizeFlow({
      destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'TCP', riskScore: 100, malicious: true, decision: 'DENY',
    });
    expect(out.riskScore).toBeUndefined();
    expect(out.malicious).toBeUndefined();
    expect(out.decision).toBeUndefined();
  });
});

describe('sanitizeDns', () => {
  it('accepts a well-formed DNS query', () => {
    expect(sanitizeDns({ domain: 'Example.COM', queryType: 'a', pid: 1, processName: 'node' })).toEqual({
      domain: 'example.com', queryType: 'A', pid: 1, processName: 'node',
    });
  });

  it('rejects a missing domain', () => {
    expect(sanitizeDns({ queryType: 'A' })).toBeNull();
  });

  it('drops an unrecognized queryType rather than accepting an arbitrary string', () => {
    const out = sanitizeDns({ domain: 'example.com', queryType: 'BOGUS' });
    expect(out.queryType).toBeUndefined();
  });

  it('only ever sets nxdomain to true, never false (tri-state — absence means unknown, not "known clean")', () => {
    expect(sanitizeDns({ domain: 'example.com', nxdomain: true }).nxdomain).toBe(true);
    expect(sanitizeDns({ domain: 'example.com', nxdomain: false }).nxdomain).toBeUndefined();
  });

  it('never surfaces sensor-provided malicious/riskScore fields', () => {
    const out = sanitizeDns({ domain: 'example.com', malicious: true, riskScore: 100 });
    expect(out.malicious).toBeUndefined();
    expect(out.riskScore).toBeUndefined();
  });
});

describe('validateSensorEvent — NETWORK_FLOW / DNS_QUERY', () => {
  it('accepts a valid NETWORK_FLOW event', () => {
    const result = validateSensorEvent(validFlowEvent());
    expect(result.ok).toBe(true);
    expect(result.event.type).toBe('NETWORK_FLOW');
    expect(result.event.flow.destinationIp).toBe('203.0.113.5');
  });

  it('rejects a NETWORK_FLOW event with no flow data', () => {
    const result = validateSensorEvent({ eventId: 'x', type: 'NETWORK_FLOW', timestamp: new Date().toISOString() });
    expect(result).toEqual({ ok: false, reason: 'missing_flow_data' });
  });

  it('accepts a valid DNS_QUERY event', () => {
    const result = validateSensorEvent(validDnsEvent());
    expect(result.ok).toBe(true);
    expect(result.event.dns.domain).toBe('example.com');
  });

  it('rejects a DNS_QUERY event with no dns data', () => {
    const result = validateSensorEvent({ eventId: 'x', type: 'DNS_QUERY', timestamp: new Date().toISOString() });
    expect(result).toEqual({ ok: false, reason: 'missing_dns_data' });
  });
});
