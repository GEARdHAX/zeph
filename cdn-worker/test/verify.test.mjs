import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import worker from '../src/index.js';
import { verifyRequest, isSafeKey, contentDisposition, computeSignature } from '../src/verify.js';

// The real backend signer: if either side changes the signed payload, these tests fail.
process.env.CDN_BASE_URL = 'https://cdn.example.test';
process.env.CDN_SIGNING_SECRET = 'parity-secret';
const require = createRequire(import.meta.url);
const backend = require('../../backend/src/cdn.js');

const SECRET = 'parity-secret';
const env = (extra = {}) => ({ CDN_SIGNING_SECRET: SECRET, ALLOWED_ORIGINS: 'https://app.example.test', BUCKET: fakeBucket(), ...extra });
const PRIVATE_KEY = 'private/users/u1/attachments/11111111-1111-1111-1111-111111111111.png';
const PUBLIC_KEY = 'public/users/u1/avatar/abc-256.jpg';

function fakeBucket(objects = {}) {
  const store = { [PRIVATE_KEY]: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [PUBLIC_KEY]: new Uint8Array([9, 9, 9]), ...objects };
  return {
    calls: [],
    async get(key, options) {
      this.calls.push(key);
      const data = store[key];
      if (!data) return null;
      const rangeHeader = options.range && options.range.get && options.range.get('range');
      let body = data;
      let range;
      if (rangeHeader) {
        const [, start, end] = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
        const offset = Number(start);
        const last = end ? Number(end) : data.length - 1;
        body = data.slice(offset, last + 1);
        range = { offset, length: body.length };
      }
      return {
        size: data.length,
        body: new Blob([body]).stream(),
        range,
        httpEtag: '"etag1"',
        writeHttpMetadata(headers) {
          headers.set('content-type', 'application/octet-stream');
        },
      };
    },
  };
}

const request = (url, init) => new Request(url, init);
const ctx = { waitUntil() {} };
const call = (url, e = env(), init) => worker.fetch(request(url, init), e, ctx);

test('a URL signed by the backend verifies in the worker (public)', async () => {
  const url = new URL(backend.createPublicUrl(PUBLIC_KEY));
  const result = await verifyRequest({ secret: SECRET, key: PUBLIC_KEY, params: url.searchParams });
  assert.deepEqual(result, { ok: true, visibility: 'public' });
});

test('a URL signed by the backend verifies in the worker (private, with filename and type)', async () => {
  const { url } = backend.createSignedDownloadUrl(PRIVATE_KEY, { filename: 'résumé & notes.pdf', attachment: true, contentType: 'application/pdf' });
  const parsed = new URL(url);
  const result = await verifyRequest({ secret: SECRET, key: PRIVATE_KEY, params: parsed.searchParams });
  assert.deepEqual(result, { ok: true, visibility: 'private' });
});

test('tampering with any signed field, the key or the secret is rejected', async () => {
  const { url } = backend.createSignedDownloadUrl(PRIVATE_KEY, { filename: 'a.pdf', attachment: true, contentType: 'application/pdf' });
  const good = new URL(url);
  const verify = (mutate, key = PRIVATE_KEY, secret = SECRET) => {
    const u = new URL(good);
    mutate(u.searchParams);
    return verifyRequest({ secret, key, params: u.searchParams });
  };
  assert.equal((await verify((p) => p.set('n', 'evil.html'))).reason, 'bad_signature');
  assert.equal((await verify((p) => p.delete('d'))).reason, 'bad_signature');
  assert.equal((await verify((p) => p.set('ct', 'text/html'))).reason, 'bad_signature');
  assert.equal((await verify((p) => p.set('exp', String(Number(p.get('exp')) + 3600)))).reason, 'bad_signature');
  assert.equal((await verify(() => {}, 'private/users/u2/attachments/other.png')).reason, 'bad_signature');
  assert.equal((await verify(() => {}, PRIVATE_KEY, 'wrong-secret')).reason, 'bad_signature');
});

test('expired and over-long private URLs are rejected; a public key cannot carry an expiry', async () => {
  const short = backend.createSignedDownloadUrl(PRIVATE_KEY, { ttlSeconds: 60 });
  const later = Math.floor(Date.now() / 1000) + 120;
  const expired = await verifyRequest({ secret: SECRET, key: PRIVATE_KEY, params: new URL(short.url).searchParams, now: later });
  assert.equal(expired.reason, 'expired');

  const tooLong = backend.createSignedDownloadUrl(PRIVATE_KEY, { ttlSeconds: 40 * 3600 });
  const longResult = await verifyRequest({ secret: SECRET, key: PRIVATE_KEY, params: new URL(tooLong.url).searchParams });
  assert.equal(longResult.reason, 'ttl_too_long'); // the worker caps lifetime even if the signer were misconfigured

  // a correctly signed public URL that nevertheless carries an expiry is refused
  const exp = '4102444800';
  const sig = await computeSignature(SECRET, { key: PUBLIC_KEY, exp });
  const withExp = await verifyRequest({ secret: SECRET, key: PUBLIC_KEY, params: new URLSearchParams({ exp, sig }) });
  assert.equal(withExp.reason, 'bad_signature');
});

test('keys outside public/ and private/, and traversal attempts, are refused', () => {
  assert.equal(isSafeKey(PUBLIC_KEY), true);
  assert.equal(isSafeKey(PRIVATE_KEY), true);
  ['healthcheck/x.txt', 'u1/legacy.png', 'public/../private/x', 'public//x', '/public/x', 'public/x/', 'private/a b.png', 'public/<script>'].forEach((key) =>
    assert.equal(isSafeKey(key), false, key),
  );
});

test('content-disposition encodes user filenames and defaults to inline', () => {
  assert.equal(contentDisposition('', 'a.png'), 'inline');
  assert.equal(contentDisposition('attachment', 'a"b/c\r\n.pdf'), "attachment; filename*=UTF-8''abc.pdf");
  assert.equal(contentDisposition('attachment', 'résumé.pdf'), "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
});

test('handler: valid public URL streams from R2 with immutable caching and CORS *', async () => {
  const res = await call(backend.createPublicUrl(PUBLIC_KEY));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [9, 9, 9]);
});

test('handler: private response is never publicly cacheable, echoes only allow-listed origins, forces the signed type', async () => {
  const { url } = backend.createSignedDownloadUrl(PRIVATE_KEY, { filename: 'a.pdf', attachment: true, contentType: 'application/pdf' });
  const ok = await call(url, env(), { headers: { origin: 'https://app.example.test' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'private, max-age=300');
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.test');
  assert.equal(ok.headers.get('vary'), 'Origin');
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.equal(ok.headers.get('content-disposition'), "attachment; filename*=UTF-8''a.pdf");

  const stranger = await call(url, env(), { headers: { origin: 'https://evil.example' } });
  assert.equal(stranger.status, 200);
  assert.equal(stranger.headers.get('access-control-allow-origin'), null);
});

test('handler: rejects bad signatures, expired links, other prefixes and traversal without touching R2', async () => {
  const e = env();
  const good = new URL(backend.createSignedDownloadUrl(PRIVATE_KEY).url);
  const forged = new URL(good);
  forged.searchParams.set('sig', '0'.repeat(64));
  assert.equal((await call(forged.toString(), e)).status, 403);

  const expired = new URL(good);
  expired.searchParams.set('exp', '1');
  assert.equal((await call(expired.toString(), e)).status, 403);

  assert.equal((await call('https://cdn.example.test/o/healthcheck/x.txt?exp=0&sig=' + 'a'.repeat(64), e)).status, 404);
  // the URL parser collapses %2e%2e, leaving a validly-shaped key with a bad signature: still refused
  assert.ok([403, 404].includes((await call('https://cdn.example.test/o/public/%2e%2e/private/x?exp=0&sig=' + 'a'.repeat(64), e)).status));
  assert.equal((await call('https://cdn.example.test/o/public/a%2F..%2Fb?exp=0&sig=' + 'a'.repeat(64), e)).status, 404); // encoded slash + dot-dot
  assert.equal((await call('https://cdn.example.test/other', e)).status, 404);
  assert.equal((await call(good.toString(), e, { method: 'POST' })).status, 405);
  assert.deepEqual(e.BUCKET.calls, [], 'R2 must not be read for any rejected request');
});

test('handler: refuses everything when the signing secret is not configured', async () => {
  const res = await call(backend.createPublicUrl(PUBLIC_KEY), env({ CDN_SIGNING_SECRET: '' }));
  assert.equal(res.status, 500);
});

test('handler: Range requests return 206 with a correct Content-Range', async () => {
  const { url } = backend.createSignedDownloadUrl(PRIVATE_KEY);
  const res = await call(url, env(), { headers: { range: 'bytes=2-5' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(res.headers.get('content-length'), '4');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [3, 4, 5, 6]);
});

test('handler: a missing object is a 404', async () => {
  const { url } = backend.createSignedDownloadUrl('private/users/u1/attachments/missing.png');
  assert.equal((await call(url)).status, 404);
});
