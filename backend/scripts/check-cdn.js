// Verifies the deployed CDN Worker end to end, without starting the server:
//   npm run cdn:check
// Needs R2_* (to upload two throwaway objects), CDN_BASE_URL and CDN_SIGNING_SECRET (same value as
// the Worker's secret). Checks: public file loads with immutable caching, private file loads with
// private caching, Range works, and a tampered signature / expired link / unsigned request are
// all refused. Prints PASS/FAIL per check, never a URL or secret.
require('dotenv').config();
const { Readable } = require('stream');
const storage = require('../src/storage');
const cdn = require('../src/cdn');

const env = process.env;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
};
const get = (url, headers = {}) => fetch(url, { headers, redirect: 'manual' });

(async () => {
  console.log(`CDN_BASE_URL        ${env.CDN_BASE_URL ? 'set' : 'MISSING'}`);
  console.log(`CDN_SIGNING_SECRET  ${env.CDN_SIGNING_SECRET ? 'set' : 'MISSING'}`);
  console.log(`R2 storage          ${storage.useObjectStorage ? 'set' : 'MISSING'}\n`);
  if (!cdn.isEnabled() || !storage.useObjectStorage) {
    console.log('Set CDN_BASE_URL, CDN_SIGNING_SECRET and the R2_* variables first.');
    process.exit(1);
  }

  const stamp = Date.now();
  const publicKey = `public/healthcheck/${stamp}.txt`;
  const privateKey = `private/healthcheck/${stamp}.txt`;
  const body = '0123456789';
  try {
    await storage.putObject(publicKey, Readable.from([Buffer.from(body)]), 'text/plain');
    await storage.putObject(privateKey, Readable.from([Buffer.from(body)]), 'text/plain');

    const pub = await get(cdn.createPublicUrl(publicKey));
    check('public file loads', pub.status === 200 && (await pub.text()) === body, `status ${pub.status}`);
    check('public file is immutable-cacheable', (pub.headers.get('cache-control') || '').includes('immutable'));

    const { url } = cdn.createSignedDownloadUrl(privateKey, { contentType: 'text/plain' });
    const priv = await get(url);
    check('private file loads with a signed URL', priv.status === 200 && (await priv.text()) === body, `status ${priv.status}`);
    check('private file is NOT publicly cacheable', (priv.headers.get('cache-control') || '').startsWith('private'));

    const ranged = await get(url, { range: 'bytes=2-5' });
    check('Range request returns 206 with the right bytes', ranged.status === 206 && (await ranged.text()) === '2345', `status ${ranged.status}`);

    const tampered = new URL(url);
    tampered.searchParams.set('sig', '0'.repeat(64));
    check('tampered signature is refused', (await get(tampered.toString())).status === 403);

    const expired = cdn.createSignedDownloadUrl(privateKey, { ttlSeconds: 60 });
    const expiredUrl = new URL(expired.url);
    expiredUrl.searchParams.set('exp', '1');
    check('modified expiry is refused', (await get(expiredUrl.toString())).status === 403);

    check('unsigned request is refused', (await get(`${env.CDN_BASE_URL.replace(/\/+$/, '')}/o/${privateKey}`)).status === 403);
    check('other prefixes are not served', (await get(`${env.CDN_BASE_URL.replace(/\/+$/, '')}/o/healthcheck/x.txt?exp=0&sig=${'a'.repeat(64)}`)).status === 404);
  } catch (err) {
    check('worker reachable', false, `${err.name}: ${err.message}`);
  } finally {
    await storage.deleteObject(publicKey).catch(() => {});
    await storage.deleteObject(privateKey).catch(() => {});
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();
