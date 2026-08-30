const {
  normalizeRawEvent, deriveEventId, u32ToIp, swapPort,
} = require('../src/events');

describe('events.normalizeRawEvent', () => {
  it('normalizes an exec observation to PROCESS_EXEC', () => {
    const event = normalizeRawEvent({
      kind: 'exec', pid: 100, ppid: 1, comm: 'sshd', ts: 123456789,
    });
    expect(event.type).toBe('PROCESS_EXEC');
    expect(event.process).toEqual({ name: 'sshd', pid: 100, parentPid: 1 });
    expect(event.eventId).toHaveLength(32);
    expect(event.sensorVersion).toBeTruthy();
  });

  it('normalizes an exit observation to PROCESS_EXIT', () => {
    const event = normalizeRawEvent({
      kind: 'exit', pid: 100, ppid: 1, comm: 'sshd', ts: 123456789,
    });
    expect(event.type).toBe('PROCESS_EXIT');
  });

  it('normalizes a connect observation to NETWORK_CONNECTION with a decoded IP/port', () => {
    // 203.0.113.5 in little-endian u32 (as bpftrace's raw skc_daddr would be)
    const daddr = (5 << 24) | (113 << 16) | (0 << 8) | 203;
    const dport = swapPort(443);
    const event = normalizeRawEvent({
      kind: 'connect', pid: 200, comm: 'curl', daddr, dport, ts: 1,
    });
    expect(event.type).toBe('NETWORK_CONNECTION');
    expect(event.network.destinationIp).toBe('203.0.113.5');
    expect(event.network.destinationPort).toBe(443);
    expect(event.network.protocol).toBe('tcp');
  });

  it('normalizes a flow observation to NETWORK_FLOW with a decoded IP/port and byte/duration counters', () => {
    const daddr = (5 << 24) | (113 << 16) | (0 << 8) | 203;
    const dport = swapPort(443);
    const event = normalizeRawEvent({
      kind: 'flow', pid: 300, comm: 'node', daddr, dport, bytes_sent: 1024, bytes_received: 4096, duration_ms: 1200, ts: 1,
    });
    expect(event.type).toBe('NETWORK_FLOW');
    expect(event.flow).toEqual({
      destinationIp: '203.0.113.5',
      destinationPort: 443,
      protocol: 'TCP',
      direction: 'OUTBOUND',
      bytesSent: 1024,
      bytesReceived: 4096,
      durationMs: 1200,
      pid: 300,
      processName: 'node',
    });
  });

  it('normalizes a dns observation to DNS_QUERY with the domain and process attribution', () => {
    const event = normalizeRawEvent({
      kind: 'dns', pid: 400, comm: 'node', domain: 'example.com', ts: 1,
    });
    expect(event.type).toBe('DNS_QUERY');
    expect(event.dns).toEqual({ domain: 'example.com', pid: 400, processName: 'node' });
  });

  it('returns null for an unrecognized kind (forward-compatible, not a crash)', () => {
    expect(normalizeRawEvent({ kind: 'mystery' })).toBeNull();
  });

  it('returns null for a non-object input', () => {
    expect(normalizeRawEvent(null)).toBeNull();
    expect(normalizeRawEvent('nope')).toBeNull();
  });

  it('deriveEventId is stable for identical raw input (retry-safe dedup)', () => {
    const raw = {
      kind: 'exec', pid: 1, ppid: 1, comm: 'x', ts: 1,
    };
    expect(deriveEventId(raw)).toBe(deriveEventId({ ...raw }));
  });

  it('deriveEventId differs for different raw input', () => {
    const a = {
      kind: 'exec', pid: 1, ppid: 1, comm: 'x', ts: 1,
    };
    const b = {
      kind: 'exec', pid: 2, ppid: 1, comm: 'x', ts: 1,
    };
    expect(deriveEventId(a)).not.toBe(deriveEventId(b));
  });

  it('u32ToIp decodes a little-endian u32 to a dotted quad', () => {
    expect(u32ToIp(0x0100007f)).toBe('127.0.0.1');
  });

  it('swapPort converts network-byte-order to host-byte-order', () => {
    expect(swapPort(0x1bb)).toBe(0xbb01); // just verifies the byte swap itself, not a specific port
    expect(swapPort(swapPort(443))).toBe(443); // double-swap is identity
  });
});
