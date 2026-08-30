const { flowIdentity } = require('../src/services/networkIntel/flowIdentity');

const BASE = {
  sourceIp: '10.0.0.5', sourcePort: 5555, destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'TCP',
};

describe('flowIdentity', () => {
  it('produces a stable identity for the same 5-tuple', () => {
    expect(flowIdentity(BASE)).toBe(flowIdentity({ ...BASE }));
  });

  it('is case-insensitive on protocol and IPs', () => {
    expect(flowIdentity(BASE)).toBe(flowIdentity({ ...BASE, protocol: 'tcp', destinationIp: '203.0.113.5'.toUpperCase() }));
  });

  it('differs when the destination port changes', () => {
    expect(flowIdentity(BASE)).not.toBe(flowIdentity({ ...BASE, destinationPort: 80 }));
  });

  it('differs when the protocol changes', () => {
    expect(flowIdentity(BASE)).not.toBe(flowIdentity({ ...BASE, protocol: 'UDP' }));
  });

  it('differs when the source port changes (a new local connection, same remote)', () => {
    expect(flowIdentity(BASE)).not.toBe(flowIdentity({ ...BASE, sourcePort: 5556 }));
  });

  it('produces a fixed-length hex identity regardless of input length', () => {
    const id = flowIdentity(BASE);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('handles missing optional fields (no sourceIp/sourcePort) without throwing', () => {
    expect(() => flowIdentity({ destinationIp: '203.0.113.5', destinationPort: 443, protocol: 'TCP' })).not.toThrow();
  });
});
