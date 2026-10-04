// Signed URLs for the Cloudflare CDN Worker (see ../../cdn-worker and docs/CDN-ARCHITECTURE.md).
//
// The R2 bucket stays private. This module only produces `https://<worker>/o/<key>?...&sig=` links;
// the Worker verifies the same HMAC and reads R2 through its own binding, so no R2 credential and
// no S3 endpoint ever reaches a client. The signing secret is shared with the Worker and must
// never be sent to the frontend or logged.
//
//   public/...   exp=0, deterministic signature -> same URL every time -> edge-cacheable forever
//   private/...  exp=<unix seconds>              -> short-lived bearer link, never shared-cached
//
// CDN off (CDN_BASE_URL or CDN_SIGNING_SECRET unset) => every function returns null and callers
// fall back to streaming through Node exactly as before.
const crypto = require('crypto');
const { isPublicKey, isPrivateKey } = require('./storageKeys');

const VERSION = 'v1';
const DEFAULT_PRIVATE_TTL_SECONDS = 3600;

const baseUrl = () => (process.env.CDN_BASE_URL || '').replace(/\/+$/, '');
const secret = () => process.env.CDN_SIGNING_SECRET || '';
const isEnabled = () => !!(baseUrl() && secret());

const privateTtlSeconds = () => {
  const configured = Number(process.env.CDN_PRIVATE_URL_TTL);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_PRIVATE_TTL_SECONDS;
  return Math.min(Math.max(Math.floor(configured), 60), 86400);
};

// Every field the Worker acts on is inside the signature, so none can be altered in the URL.
const sign = ({ key, exp, disposition = '', name = '', contentType = '' }) =>
  crypto.createHmac('sha256', secret()).update([VERSION, key, String(exp), disposition, name, contentType].join('\n')).digest('hex');

const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

const buildUrl = ({ key, exp, disposition = '', name = '', contentType = '' }) => {
  const sig = sign({ key, exp, disposition, name, contentType });
  const query = new URLSearchParams({ exp: String(exp) });
  if (disposition) query.set('d', disposition);
  if (name) query.set('n', name);
  if (contentType) query.set('ct', contentType);
  query.set('sig', sig);
  return `${baseUrl()}/o/${encodeKey(key)}?${query.toString()}`;
};

// For public/ keys only. Returns null when the CDN is off or the key is not public.
const createPublicUrl = (key) => {
  if (!isEnabled() || !isPublicKey(key)) return null;
  return buildUrl({ key, exp: 0 });
};

// For private/ keys only. The caller MUST already have authorized the requester.
// Returns { url, expiresAt } or null.
const createSignedDownloadUrl = (key, { filename = '', attachment = false, contentType = '', ttlSeconds } = {}) => {
  if (!isEnabled() || !isPrivateKey(key)) return null;
  const exp = Math.floor(Date.now() / 1000) + (ttlSeconds || privateTtlSeconds());
  return {
    url: buildUrl({ key, exp, disposition: attachment ? 'attachment' : '', name: filename, contentType }),
    expiresAt: exp * 1000,
  };
};

module.exports = { isEnabled, createPublicUrl, createSignedDownloadUrl, sign, VERSION };
