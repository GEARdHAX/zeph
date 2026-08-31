// Phase 7 audit finding: no SIGTERM/SIGINT handler existed anywhere in
// index.js — on every deploy/restart, none of the 8 independent Redis
// connections were closed, Mongo was never explicitly closed, BullMQ
// workers were killed mid-job, the HTTP server was never .close()d, and
// Mediasoup workers were never closed (leaking real UDP transports and
// C++ resources — confirmed via `tasklist`/`mediasoup-worker.exe` showing
// orphaned processes before this fix).
//
// index.js is the actual process entrypoint (runs its startup side
// effects on require, not a pure module), so gracefulShutdown() itself
// isn't independently importable/unit-testable without a larger refactor
// of a file this central to the running app — out of scope for this
// hardening pass. What IS directly testable, and was manually verified
// end-to-end via a real boot + in-process signal emission (Windows dev
// environment cannot deliver a real cross-process SIGTERM/SIGINT to a
// child Node process — a documented Node-on-Windows limitation, not
// something this test suite can work around; the real behavior is
// verified on the actual Linux production target):
//   1. every close*Connection()/close() function the shutdown handler
//      calls actually exists and is callable — a regression guard against
//      a future rename/removal silently breaking shutdown.
//   2. each of those functions genuinely resolves without throwing when
//      called with no active connection (the common case in this test
//      suite, which runs with no live app boot).
describe('graceful shutdown — close function wiring', () => {
  it('every Redis client close function index.js\'s shutdown handler calls actually exists and is callable', () => {
    const { closeQueueConnection } = require('../src/queues/connection');
    const { closeRedisAdapterConnections } = require('../src/setupRedisAdapter');
    const { closeProfileCacheConnection } = require('../src/userProfileCache');
    const { closeThreatIntelCacheConnection } = require('../src/services/threatIntel/cache');
    const { closeRiskCacheConnection } = require('../src/services/zeroTrust/riskCache');
    const { closeSensorDedupConnection } = require('../src/services/ebpf/sensorEventDedup');
    const { closeNetworkIntelConnection } = require('../src/services/networkIntel/cache');
    const { closeSecurityAiCacheConnection } = require('../src/services/securityAi/cache');

    [
      closeQueueConnection, closeRedisAdapterConnections, closeProfileCacheConnection,
      closeThreatIntelCacheConnection, closeRiskCacheConnection, closeSensorDedupConnection,
      closeNetworkIntelConnection, closeSecurityAiCacheConnection,
    ].forEach((fn) => expect(typeof fn).toBe('function'));
  });

  it('mediasoup module exports a callable close() function', () => {
    const mediasoup = require('../src/mediasoup');
    expect(typeof mediasoup.close).toBe('function');
  });

  it('every Redis close function resolves cleanly with no active connection (the common no-op case)', async () => {
    const { closeQueueConnection } = require('../src/queues/connection');
    const { closeRedisAdapterConnections } = require('../src/setupRedisAdapter');
    const { closeProfileCacheConnection } = require('../src/userProfileCache');
    const { closeThreatIntelCacheConnection } = require('../src/services/threatIntel/cache');
    const { closeRiskCacheConnection } = require('../src/services/zeroTrust/riskCache');
    const { closeSensorDedupConnection } = require('../src/services/ebpf/sensorEventDedup');
    const { closeNetworkIntelConnection } = require('../src/services/networkIntel/cache');
    const { closeSecurityAiCacheConnection } = require('../src/services/securityAi/cache');

    await expect(Promise.all([
      closeQueueConnection(),
      closeRedisAdapterConnections(),
      closeProfileCacheConnection(),
      closeThreatIntelCacheConnection(),
      closeRiskCacheConnection(),
      closeSensorDedupConnection(),
      closeNetworkIntelConnection(),
      closeSecurityAiCacheConnection(),
    ])).resolves.toBeDefined();
  });

  it('mediasoup.close() resolves cleanly when init() was never called (MEDIASOUP_ENABLED=false — the current Render production config)', async () => {
    const mediasoup = require('../src/mediasoup');
    await expect(mediasoup.close()).resolves.toBeUndefined();
  });

  it('calling mediasoup.close() twice in a row does not throw (idempotent, matches every other close*Connection()\'s own contract)', async () => {
    const mediasoup = require('../src/mediasoup');
    await mediasoup.close();
    await expect(mediasoup.close()).resolves.toBeUndefined();
  });
});
