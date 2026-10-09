// Concurrent media-upload capacity through the Node proxy upload route (the path used when object storage is not
// configured, i.e. local-disk storage). This exercises everything the server does for an upload: authentication,
// policy checks, content sniffing, thumbnail generation, storage write and the database record. It does NOT cover the
// direct-to-R2 path, where the bytes bypass this server entirely.
//
// Usage: node loadtest/upload-load.js [concurrency] [baseUrl] [kind: png|pdf]
const { execSync } = require('child_process');
const path = require('path');
const sharp = require('sharp');
const { summarize, printSummary } = require('./lib/percentiles');

const concurrency = Number(process.argv[2]) || 25;
const baseUrl = process.argv[3] || 'http://127.0.0.1:4099';
const kind = process.argv[4] || 'png';

const makeFile = async () => {
  if (kind === 'pdf') {
    return { buf: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'), name: 'doc.pdf', type: 'application/pdf' };
  }
  // ~100 KB noisy PNG so thumbnail generation does real work
  const raw = Buffer.alloc(256 * 256 * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 31 + (i >> 3)) & 255;
  const buf = await sharp(raw, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
  return { buf, name: 'photo.png', type: 'image/png' };
};

const main = async () => {
  const seedOut = execSync(`node "${path.join(__dirname, 'seed.js')}" ${concurrency}`, {
    cwd: path.join(__dirname, '..'),
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const { tokens } = JSON.parse(seedOut.trim().split('\n').pop());
  const file = await makeFile();
  console.log(`Uploading ${concurrency} x ${file.name} (${file.buf.length} bytes) concurrently`);

  const wallStart = process.hrtime.bigint();
  const results = await Promise.all(
    tokens.slice(0, concurrency).map(async (token) => {
      const start = process.hrtime.bigint();
      let status = -1;
      try {
        const body = new FormData();
        body.append('file', new Blob([file.buf], { type: file.type }), file.name);
        const res = await fetch(`${baseUrl}/api/upload/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
        status = res.status;
      } catch (e) {
        status = -1;
      }
      return { ms: Number(process.hrtime.bigint() - start) / 1e6, status };
    }),
  );
  const wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;

  const ok = results.filter((r) => r.status === 200);
  const breakdown = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  printSummary(`Concurrent upload x${concurrency} (${kind})`, summarize(ok.map((r) => r.ms), { errors: results.length - ok.length, total: results.length }), {
    statusBreakdown: JSON.stringify(breakdown),
    wallClockMs: wallMs.toFixed(0),
    successfulUploadsPerSecond: (ok.length / (wallMs / 1000)).toFixed(1),
  });
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
