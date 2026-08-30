const crypto = require('crypto');
const validator = require('validator');

// Supported IOC types (spec section 3) — only what has a concrete use case
// in this phase: IP is the actual priority (spec section 17), the rest
// exist so the schema/service shape doesn't need a rewrite once a future
// phase (network sensor, file-hash reputation on upload) actually produces
// them. No PHONE/EMAIL/etc — nothing in ZEPH generates those as security
// indicators today.
const IndicatorTypes = Object.freeze({
  IP: 'IP',
  DOMAIN: 'DOMAIN',
  URL: 'URL',
  HASH: 'HASH',
});

// RFC1918 (IPv4 private), loopback, link-local, and IPv6 unique-local/
// link-local ranges — spec section 27: never send these to an external
// provider. Deliberately hand-rolled (no ipaddr.js/netmask dependency) —
// this is a short, stable, well-known list; `validator` (already a
// dependency, used elsewhere for isEmail) has no private-range helper, and
// pulling in a whole IP-math library for six range checks would be exactly
// the unjustified-dependency spec section 8 (Phase 1's own instruction,
// still the house style) warns against.
const isPrivateOrReservedIp = (ip) => {
  if (!validator.isIP(ip)) return true; // fail toward "don't call the provider" on anything unparseable
  if (validator.isIP(ip, 4)) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true; // "this network"
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique-local
  if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped IPv6
  return false;
};

// Detects which IOC type a raw string looks like, without yet validating it
// strictly — callers use this to route to the right normalize/validate
// function. Order matters: HASH before DOMAIN (a bare hex string could
// technically look domain-ish is never true here since domains require a
// dot+TLD, but URL before DOMAIN matters — a URL contains a domain).
const detectType = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (validator.isIP(trimmed)) return IndicatorTypes.IP;
  if (/^[a-f0-9]{32}$/i.test(trimmed) || /^[a-f0-9]{40}$/i.test(trimmed) || /^[a-f0-9]{64}$/i.test(trimmed)) {
    return IndicatorTypes.HASH;
  }
  if (validator.isURL(trimmed, { require_protocol: true })) return IndicatorTypes.URL;
  // isFQDN rejects a trailing root dot ("example.com.") and is case-
  // sensitive about nothing in particular but is still stricter than what
  // normalizeDomain below actually needs — detection only strips the one
  // thing normalizeDomain also strips (trailing dot) so "EXAMPLE.COM." is
  // correctly routed to DOMAIN instead of silently falling through to null;
  // the real validation still happens in normalizeDomain, unchanged.
  if (validator.isFQDN(trimmed.replace(/\.$/, ''))) return IndicatorTypes.DOMAIN;
  return null;
};

// Normalization (spec section 5) — safe, information-preserving where
// possible. Never "fixes" a malformed indicator into something else; either
// normalizes deterministically or returns null (caller treats null as
// invalid, never silently substitutes a guess).
const normalizeIp = (raw) => {
  if (!raw || !validator.isIP(raw.trim())) return null;
  // IPv6 addresses are case-normalized (validator doesn't reformat
  // shorthand/expansion — that's a deliberate scope limit, not a bug: full
  // RFC5952 canonicalization needs real IP-math, and ZEPH has no IPv6-heavy
  // traffic pattern today that would make partial-form duplicates a
  // meaningful cache-miss problem worth a dependency for).
  return raw.trim().toLowerCase();
};

const normalizeDomain = (raw) => {
  if (!raw) return null;
  // Trailing dot (DNS root, "example.com.") and case are the two safe,
  // meaning-preserving normalizations spec section 5 asks for explicitly.
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, '');
  return validator.isFQDN(trimmed) ? trimmed : null;
};

const normalizeUrl = (raw) => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!validator.isURL(trimmed, { require_protocol: true })) return null;
  try {
    const url = new URL(trimmed);
    // Scheme+host lowercased (meaning-preserving — DNS/scheme are case-
    // insensitive); path/query/fragment left exactly as-is, since those CAN
    // be case-sensitive and rewriting them would be lossy. Credentials
    // (user:pass@host) are stripped — spec section 19: "be careful with...
    // credentials," and a reputation lookup never needs them.
    url.username = '';
    url.password = '';
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}${url.search}${url.hash}`;
  } catch (e) {
    return null;
  }
};

const normalizeHash = (raw) => {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (validator.isHash(trimmed, 'md5') || validator.isHash(trimmed, 'sha1') || validator.isHash(trimmed, 'sha256')) {
    return trimmed;
  }
  return null;
};

// Public entry point — detects type, validates, and normalizes in one call.
// Returns null (not a thrown error) for anything invalid — every caller in
// this phase treats "cannot be normalized" as "do not look this up,"
// consistent with spec section 5's "never trust an indicator merely because
// it is syntactically valid" (this function doesn't even get that far for
// garbage input) and section 27 (private IPs normalize fine but are then
// separately filtered by isPrivateOrReservedIp before any provider call).
const normalizeIndicator = (raw, hintedType) => {
  const type = hintedType || detectType(raw);
  if (!type) return null;

  let normalized = null;
  if (type === IndicatorTypes.IP) normalized = normalizeIp(raw);
  else if (type === IndicatorTypes.DOMAIN) normalized = normalizeDomain(raw);
  else if (type === IndicatorTypes.URL) normalized = normalizeUrl(raw);
  else if (type === IndicatorTypes.HASH) normalized = normalizeHash(raw);

  if (!normalized) return null;
  return { type, normalized };
};

// Stable cache/lookup key — sha256 of `${type}:${normalized}`, not the raw
// normalized string itself, so a URL containing a long path never becomes
// an unwieldy Redis key (and so every indicator type has a uniform, fixed-
// length key regardless of how long the underlying value is).
const indicatorKey = (type, normalized) => crypto.createHash('sha256').update(`${type}:${normalized}`).digest('hex');

module.exports = {
  IndicatorTypes,
  detectType,
  normalizeIndicator,
  normalizeIp,
  normalizeDomain,
  normalizeUrl,
  normalizeHash,
  isPrivateOrReservedIp,
  indicatorKey,
};
