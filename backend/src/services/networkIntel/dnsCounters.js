const { getClient } = require('./cache');
const logger = require('../../logger');

// DNS security signals (spec section 11) — deterministic, Redis-backed
// sliding-window counters, same pattern as windowCounters.js. Two separate
// signals, kept distinct on purpose (spec's own worked example: "high
// NXDOMAIN volume -> DNS_ANOMALY", explicitly NOT "-> MALWARE" from one
// heuristic alone):
//
//   query volume  — many DISTINCT domains queried by one process in the
//                   window (DNS tunneling/enumeration shape)
//   NXDOMAIN rate — many failed lookups by one process in the window
//                   (domain-generation-algorithm malware shape)
const KEY_PREFIX = 'netintel:dns:';
const domainsKey = (sensorId, pid) => `${KEY_PREFIX}domains:${sensorId}:${pid}`;
const nxdomainKey = (sensorId, pid) => `${KEY_PREFIX}nxdomain:${sensorId}:${pid}`;

const recordDnsQuery = async ({
  sensorId, pid, domain, nxdomain, windowMs,
}) => {
  const redis = getClient();
  if (!redis || !sensorId || !Number.isInteger(pid)) {
    return { distinctDomains: 0, nxdomainCount: 0 };
  }

  const windowSeconds = Math.ceil(windowMs / 1000);

  try {
    const dk = domainsKey(sensorId, pid);
    const nk = nxdomainKey(sensorId, pid);
    const pipeline = redis.pipeline();
    if (domain) pipeline.sadd(dk, domain);
    pipeline.expire(dk, windowSeconds);
    if (nxdomain) {
      pipeline.incr(nk);
      pipeline.expire(nk, windowSeconds);
    }
    await pipeline.exec();

    const [distinctDomains, nxdomainCountRaw] = await Promise.all([
      redis.scard(dk),
      redis.get(nk),
    ]);
    return { distinctDomains, nxdomainCount: Number(nxdomainCountRaw) || 0 };
  } catch (err) {
    logger.warn({ err, sensorId, pid }, 'network_intel_dns_counter_failed');
    return { distinctDomains: 0, nxdomainCount: 0 };
  }
};

module.exports = { recordDnsQuery };
