const { getClient } = require('./cache');
const logger = require('../../logger');

// Bounded sliding-window aggregation (spec section 17-21/27) — every key is
// scoped to one (sensorId, pid) process identity and expires on its own via
// Redis TTL, so this module never accumulates unbounded history in memory
// OR in Redis: a process that stops connecting simply ages out. windowMs is
// config.networkFlowWindowMs (spec section 49), passed in by the caller
// rather than imported directly, so tests can use a short window without
// touching global config.
const KEY_PREFIX = 'netintel:';

const portsKey = (sensorId, pid) => `${KEY_PREFIX}ports:${sensorId}:${pid}`;
const hostsKey = (sensorId, pid) => `${KEY_PREFIX}hosts:${sensorId}:${pid}`;
const beaconKey = (sensorId, pid, destinationIp) => `${KEY_PREFIX}beacon:${sensorId}:${pid}:${destinationIp}`;
const exfilKey = (sensorId, pid, destinationIp) => `${KEY_PREFIX}exfil:${sensorId}:${pid}:${destinationIp}`;

// Records one flow's contribution to every counter it's relevant to.
// Returns the CURRENT counts (post-record) so the caller can evaluate
// thresholds without a second round trip. Redis unavailable -> all-zero
// counts (fail toward "no signal," never toward "flag everything" — the
// same conservative direction every other Redis-backed module in this
// codebase takes on an outage).
const recordFlow = async ({
  sensorId, pid, destinationIp, destinationPort, bytesSent, windowMs,
}) => {
  const redis = getClient();
  if (!redis || !sensorId || !Number.isInteger(pid)) {
    return {
      distinctPorts: 0, distinctHosts: 0, beaconTimestamps: [], cumulativeBytes: 0,
    };
  }

  const windowSeconds = Math.ceil(windowMs / 1000);
  const now = Date.now();

  try {
    const pk = portsKey(sensorId, pid);
    const hk = hostsKey(sensorId, pid);
    const pipeline = redis.pipeline();
    if (Number.isInteger(destinationPort)) pipeline.sadd(pk, String(destinationPort));
    pipeline.expire(pk, windowSeconds);
    if (destinationIp) pipeline.sadd(hk, destinationIp);
    pipeline.expire(hk, windowSeconds);

    let bk = null;
    let ek = null;
    if (destinationIp) {
      bk = beaconKey(sensorId, pid, destinationIp);
      pipeline.zadd(bk, now, String(now)); // sorted set of connection timestamps to this one destination
      pipeline.expire(bk, windowSeconds);

      if (Number.isInteger(bytesSent) && bytesSent > 0) {
        ek = exfilKey(sensorId, pid, destinationIp);
        pipeline.incrby(ek, bytesSent);
        pipeline.expire(ek, windowSeconds);
      }
    }

    const results = await pipeline.exec();
    const [distinctPorts, distinctHosts] = await Promise.all([
      redis.scard(pk),
      redis.scard(hk),
    ]);
    const beaconTimestamps = bk ? (await redis.zrange(bk, 0, -1)).map(Number) : [];
    const cumulativeBytes = ek ? Number(await redis.get(ek)) || 0 : 0;

    // Pipeline errors surface per-command in `results`, not as a thrown
    // exception — log but don't fail the caller over a single counter op.
    const failed = (results || []).find(([err]) => err);
    if (failed) logger.warn({ err: failed[0], sensorId, pid }, 'network_intel_window_counter_partial_failure');

    return {
      distinctPorts, distinctHosts, beaconTimestamps, cumulativeBytes,
    };
  } catch (err) {
    logger.warn({ err, sensorId, pid }, 'network_intel_window_counter_failed');
    return {
      distinctPorts: 0, distinctHosts: 0, beaconTimestamps: [], cumulativeBytes: 0,
    };
  }
};

module.exports = { recordFlow };
