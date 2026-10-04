// Verifies your Cloudflare R2 credentials without starting the server:
//   npm run r2:check
// Creates one tiny object, reads it back, overwrites it, deletes it and confirms it is gone. Prints which variables are set and
// whether R2 accepted them - never the values.
require('dotenv').config();
const storage = require('../src/storage');

const env = process.env;
const set = (name) => (env[name] ? 'set' : 'MISSING');

(async () => {
  ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].forEach((n) => console.log(`${n.padEnd(22)}${set(n)}`));

  if (!storage.useObjectStorage || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    console.log('\nR2 is not fully configured - uploads would use local disk. Set all four variables.');
    process.exit(1);
  }

  const key = `healthcheck/${Date.now()}.txt`;
  const { Readable } = require('stream');
  const read = async () => {
    const chunks = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of await storage.getObjectStream(key)) chunks.push(chunk);
    return Buffer.concat(chunks).toString();
  };
  const step = (name) => console.log(`  ${name.padEnd(8)}ok`);
  try {
    console.log('');
    await storage.putObject(key, Readable.from([Buffer.from('zeph r2 check')]), 'text/plain');
    step('create');
    if ((await read()) !== 'zeph r2 check') throw new Error('read-back did not match what was written');
    step('read');
    await storage.putObject(key, Readable.from([Buffer.from('updated')]), 'text/plain');
    if ((await read()) !== 'updated') throw new Error('overwrite did not replace the object');
    step('update');
    await storage.deleteObject(key);
    const stillThere = await storage.getObjectStream(key).then(() => true, () => false);
    if (stillThere) throw new Error('object still readable after delete');
    step('delete');
    console.log('\nOK: create, read, update and delete all worked.');
  } catch (err) {
    console.log(`\nFAILED: ${err.name}: ${err.message}`);
    console.log('Check: endpoint has no bucket name in it, token has Object Read & Write on this bucket, bucket name is exact.');
    process.exit(1);
  }
})();
