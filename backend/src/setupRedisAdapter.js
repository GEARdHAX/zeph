const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const logger = require('./logger');

// Every group/DM delivery in this app is a targeted
// `store.io.to(userId).emit(...)` (see broadcastToGroup.js, message.js),
// never a Socket.IO room join. Without this adapter, that targeting only
// resolves against sockets connected to THIS process — on a second
// instance behind a load balancer, a message would silently never reach a
// recipient connected to the other instance. Best-effort: redisUrl unset
// or unreachable means single-process mode, same as running with no Redis
// at all today — never a boot crash. See DECISIONS.md D-035.
const setupRedisAdapter = async (io, redisUrl) => {
  if (!redisUrl) {
    logger.info('REDIS_URL not set — Socket.IO running in single-process mode');
    return false;
  }
  // retryStrategy:null + connectTimeout — ioredis's default retryStrategy
  // keeps retrying reconnection forever with backoff, which would hang this
  // startup check indefinitely against an unreachable host instead of
  // falling back within a bounded time. This is only the initial-connect
  // policy; the adapter's own long-lived pub/sub clients (once connected)
  // still benefit from ioredis's normal reconnect behavior for a
  // Redis blip after boot — that's separate client state, not overridden here.
  try {
    const pubClient = new Redis(redisUrl, {
      lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 5000, retryStrategy: () => null,
    });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    // Reconnect behavior for the adapter's actual lifetime (post-boot) —
    // restored now that the initial connection succeeded, so a transient
    // Redis blip later doesn't permanently kill multi-instance delivery.
    pubClient.options.retryStrategy = (times) => Math.min(times * 200, 5000);
    subClient.options.retryStrategy = (times) => Math.min(times * 200, 5000);
    io.adapter(createAdapter(pubClient, subClient));
    pubClient.on('error', (err) => logger.warn({ err }, 'Redis pub client error (Socket.IO adapter)'));
    subClient.on('error', (err) => logger.warn({ err }, 'Redis sub client error (Socket.IO adapter)'));
    logger.info('Socket.IO Redis adapter connected — multi-instance delivery enabled');
    return true;
  } catch (err) {
    logger.warn({ err }, 'Failed to connect Socket.IO Redis adapter — falling back to single-process mode');
    return false;
  }
};

module.exports = setupRedisAdapter;
