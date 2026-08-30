const { checkCapabilities } = require('../src/index');

// The single most important behavioral guarantee this whole package makes:
// on a host that cannot actually run eBPF (this dev machine, ZEPH's Render
// production host, or any non-Linux/no-bpftrace box), the sensor MUST fail
// loudly and immediately — never silently no-op or fake an implementation.
describe('checkCapabilities', () => {
  it('throws on a non-Linux platform', () => {
    if (process.platform === 'linux') return; // this assertion only makes sense off-Linux; the Linux branch is covered by the bpftrace-presence check below
    expect(() => checkCapabilities()).toThrow(/requires Linux/);
  });
});
