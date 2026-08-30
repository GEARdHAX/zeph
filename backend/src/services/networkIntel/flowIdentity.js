const crypto = require('crypto');

// Stable normalized flow identity (spec section 6) — source IP+port,
// destination IP+port, protocol. Deliberately NOT derived from any raw
// packet data (no sequence numbers, no TTL, nothing that varies packet to
// packet within the same logical connection) — just the 5-tuple every flow-
// tracking tool (conntrack, NetFlow, this) already uses as the canonical
// identity. Hashed (like threatIntel/indicators.js's indicatorKey) so
// Redis keys stay a uniform, fixed length regardless of IPv4 vs IPv6.
const flowIdentity = ({
  sourceIp, sourcePort, destinationIp, destinationPort, protocol,
}) => {
  const normalized = [
    (sourceIp || '').toLowerCase(),
    sourcePort ?? '',
    (destinationIp || '').toLowerCase(),
    destinationPort ?? '',
    (protocol || '').toUpperCase(),
  ].join(':');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
};

module.exports = { flowIdentity };
