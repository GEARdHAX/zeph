// Signature + key validation for the CDN Worker. Pure functions (no Cloudflare APIs besides the
// standard Web Crypto available in Workers and Node), so they are unit-tested against the
// backend's signer in test/verify.test.mjs.
//
// Must stay byte-for-byte compatible with backend/src/cdn.js `sign()`:
//   HMAC-SHA256(secret, [v1, key, exp, disposition, name, contentType].join('\n')) as hex.
const VERSION = 'v1';
const MAX_PRIVATE_TTL_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();

// Strict allowlist: two visibilities only, plain path characters, no traversal.
const KEY_PATTERN = /^(public|private)\/[A-Za-z0-9._\-/]{1,500}$/;
export const isSafeKey = (key) => KEY_PATTERN.test(key) && !key.includes('..') && !key.includes('//') && !key.endsWith('/');

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const computeSignature = async (secret, { key, exp, disposition = '', name = '', contentType = '' }) => {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode([VERSION, key, String(exp), disposition, name, contentType].join('\n')));
  return toHex(mac);
};

// Constant-time comparison of two hex strings.
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// -> { ok: true, visibility } | { ok: false, status, reason }
export const verifyRequest = async ({ secret, key, params, now = Math.floor(Date.now() / 1000) }) => {
  if (!secret) return { ok: false, status: 500, reason: 'not_configured' };
  if (!isSafeKey(key)) return { ok: false, status: 404, reason: 'bad_key' };

  const exp = params.get('exp') ?? '';
  const sig = params.get('sig') ?? '';
  const parts = { key, exp, disposition: params.get('d') ?? '', name: params.get('n') ?? '', contentType: params.get('ct') ?? '' };
  if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, status: 403, reason: 'bad_signature' };
  if (!safeEqual(sig, await computeSignature(secret, parts))) return { ok: false, status: 403, reason: 'bad_signature' };

  const visibility = key.startsWith('public/') ? 'public' : 'private';
  if (visibility === 'public') {
    // Public links are deterministic and never expire; a public key must not carry an expiry.
    if (exp !== '0') return { ok: false, status: 403, reason: 'bad_signature' };
    return { ok: true, visibility };
  }
  if (!/^\d{1,12}$/.test(exp)) return { ok: false, status: 403, reason: 'bad_signature' };
  const expiresAt = Number(exp);
  if (expiresAt <= now) return { ok: false, status: 403, reason: 'expired' };
  if (expiresAt - now > MAX_PRIVATE_TTL_SECONDS + 60) return { ok: false, status: 403, reason: 'ttl_too_long' };
  return { ok: true, visibility };
};

// RFC 6266 / 5987 header value; the filename is user-controlled, so it is encoded, never inlined.
export const contentDisposition = (disposition, name) => {
  if (disposition !== 'attachment') return 'inline';
  const safe = (name || 'download').replace(/[\x00-\x1f"\/]/g, '').slice(0, 255) || 'download';
  return `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`;
};
