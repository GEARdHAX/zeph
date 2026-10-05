// zeph: edge delivery for the PRIVATE zeph-uploads R2 bucket.
//
//   GET /o/<public|private>/<key>?exp=&sig=[&d=attachment][&n=<filename>][&ct=<content-type>]
//
// The Render backend decides who may read a file and signs a URL (backend/src/cdn.js); this Worker
// only verifies that signature (src/verify.js), then streams the object from R2 through the
// bucket binding. No R2 credentials exist here. See docs/CDN-ARCHITECTURE.md.
//
//   public/   deterministic URL, exp=0 -> `public, max-age=31536000, immutable`, cached at the edge
//   private/  expiring URL            -> `private, max-age=300`, NEVER stored in a shared cache
import { verifyRequest, contentDisposition } from './verify.js';

const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PRIVATE_CACHE_CONTROL = 'private, max-age=300';

const plain = (status, body = '') =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

const allowedOrigins = (env) => (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);

// Public responses are shared-cached, so they must not carry one origin's CORS answer: `*` is safe
// because they need no credentials. Private responses echo only an allow-listed origin.
const corsFor = (request, env, visibility) => {
  if (visibility === 'public') return { 'access-control-allow-origin': '*' };
  const origin = request.headers.get('origin');
  return origin && allowedOrigins(env).includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
};

const decodeKey = (pathname) => {
  try {
    return pathname.slice('/o/'.length).split('/').map(decodeURIComponent).join('/');
  } catch (e) {
    return null;
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin');
      const headers = { 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'range', 'access-control-max-age': '86400', vary: 'Origin' };
      if (origin && allowedOrigins(env).includes(origin)) headers['access-control-allow-origin'] = origin;
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'method not allowed');
    if (!url.pathname.startsWith('/o/')) return plain(404, 'not found');

    const key = decodeKey(url.pathname);
    if (key === null) return plain(404, 'not found');

    // Signature first: an unauthorized request must never reach the cache or R2.
    const check = await verifyRequest({ secret: env.CDN_SIGNING_SECRET, key, params: url.searchParams });
    if (!check.ok) {
      // Reason only: never the URL, signature or key.
      console.warn(JSON.stringify({ event: 'cdn_request_rejected', reason: check.reason }));
      return plain(check.status === 404 ? 404 : check.status === 500 ? 500 : 403, check.status === 404 ? 'not found' : 'forbidden');
    }
    const { visibility } = check;

    const disposition = url.searchParams.get('d') || '';
    // One well-formed byte range (`bytes=0-99`, `bytes=500-`, `bytes=-5`) is honoured. Anything else (garbage, or several
    // ranges at once) is IGNORED and the whole object is served with a plain 200, as HTTP says to do with a Range header
    // that cannot be understood; it must not become a 206 for the full body.
    const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
    const hasRange = !!rangeMatch && (rangeMatch[1] !== '' || rangeMatch[2] !== '');
    // Cloudflare's Cache API is a no-op on *.workers.dev: only use it on a custom domain.
    const edgeCacheable =
      visibility === 'public' && request.method === 'GET' && !hasRange && !disposition && !url.hostname.endsWith('.workers.dev') && typeof caches !== 'undefined';
    const cacheKey = edgeCacheable ? new Request(`${url.origin}${url.pathname}`, { method: 'GET' }) : null;
    if (cacheKey) {
      const hit = await caches.default.match(cacheKey);
      if (hit) return hit;
    }

    let object;
    try {
      object = await env.BUCKET.get(key, hasRange ? { range: request.headers, onlyIf: request.headers } : { onlyIf: request.headers });
    } catch (err) {
      // A range that starts past the end of the object is a client error (416), not an upstream failure.
      if (hasRange && /range|10039/i.test((err && err.message) || '')) {
        const meta = await env.BUCKET.head(key).catch(() => null);
        if (!meta) return plain(404, 'not found');
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${meta.size}`, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        });
      }
      console.error(JSON.stringify({ event: 'cdn_r2_error', message: err && err.message }));
      return plain(502, 'upstream error');
    }
    if (object === null) {
      console.warn(JSON.stringify({ event: 'cdn_object_missing', visibility }));
      return plain(404, 'not found');
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    // The signed content type wins: it comes from the backend's validated record, not from
    // whatever the uploader's PUT happened to send.
    headers.set('content-type', url.searchParams.get('ct') || headers.get('content-type') || 'application/octet-stream');
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('content-disposition', contentDisposition(disposition, url.searchParams.get('n')));
    headers.set('cache-control', visibility === 'public' ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('cross-origin-resource-policy', 'cross-origin');
    headers.set('referrer-policy', 'no-referrer');
    Object.entries(corsFor(request, env, visibility)).forEach(([name, value]) => headers.set(name, value));

    // Conditional request satisfied (If-None-Match): R2 returns metadata without a body.
    if (!('body' in object) || object.body === undefined) return new Response(null, { status: 304, headers });

    let status = 200;
    if (hasRange && object.range) {
      const { offset = 0, length = object.size - offset } = object.range;
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('content-length', String(length));
      status = 206;
    } else {
      headers.set('content-length', String(object.size));
    }

    const response = new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
    if (cacheKey && status === 200) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  },
};
