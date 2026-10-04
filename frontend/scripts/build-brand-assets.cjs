// Regenerates every icon and the social-preview image in frontend/public from ONE vector mark, so they are
// always square, sharp and consistent. Run from frontend/:   node scripts/build-brand-assets.cjs
//
//  - favicon.svg / favicon-{16,32,48,96}.png / favicon.ico : browser tabs and Google results. Google needs a
//    square icon whose size is a multiple of 48 px (so 48 and 96 are generated), at a stable crawlable URL.
//  - apple-touch-icon.png (180), logo192.png, logo512.png, logo-maskable-512.png : home screen / PWA / the
//    Organization logo in the page's structured data.
//  - og-zeph-v2.png (1200x630) : link previews. The lockup is CENTRED so it survives both a wide card and the
//    square centre-crop chat apps use for the thumbnail. Needs Playwright (npm i --no-save playwright), the
//    rest only needs sharp. The "-v2" name forces chat apps and crawlers to refetch instead of reusing a cache.
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  sharp = require(path.resolve(__dirname, '../../backend/node_modules/sharp'));
}

const PUBLIC = path.resolve(__dirname, '../public');
const BG = '#08080a';
const RED = '#e11d48';
const WHITE = '#fafafa';

// The mark: four nodes joined to a red centre. Drawn on a 100-unit grid; geometry is deliberately bold so it
// still reads at 16 px.
const mark = () => `
  <g stroke="${WHITE}" stroke-width="7" stroke-linecap="round">
    <line x1="50" y1="50" x2="50" y2="14"/><line x1="50" y1="50" x2="50" y2="86"/>
    <line x1="50" y1="50" x2="14" y2="50"/><line x1="50" y1="50" x2="86" y2="50"/>
  </g>
  <g fill="${WHITE}">
    <circle cx="50" cy="12" r="9"/><circle cx="50" cy="88" r="9"/><circle cx="12" cy="50" r="9"/><circle cx="88" cy="50" r="9"/>
  </g>
  <circle cx="50" cy="50" r="15" fill="${RED}"/>`;

// A square tile with the mark centred. `scale` is the share of the tile the mark spans; `radius` rounds the
// corners (0 = full-bleed, for platforms that apply their own mask).
const tileSvg = (size, { scale = 0.74, radius = 0.22 } = {}) => {
  const m = (100 * scale) / 100;
  const offset = (100 - 100 * m) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${radius * 100}" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${m})">${mark()}</g>
</svg>`;
};

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

// ICO container holding PNG images (supported by every current browser).
const ico = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
};

const write = (name, data) => {
  fs.writeFileSync(path.join(PUBLIC, name), data);
  console.log('wrote', name, `${data.length} bytes`);
};

const ogHtml = () => {
  const font = path.resolve(__dirname, '../node_modules/@fontsource-variable/google-sans-flex/files/google-sans-flex-latin-wght-normal.woff2');
  const fontUrl = `file:///${font.replace(/\\/g, '/')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'GSF'; src: url('${fontUrl}') format('woff2'); font-weight: 100 1000; }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: ${BG}; font-family: 'GSF', 'Segoe UI', Arial, sans-serif; color: ${WHITE};
    position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .glow { position: absolute; left: 50%; top: 50%; width: 1100px; height: 1100px; transform: translate(-50%, -50%);
    background: radial-gradient(circle, rgba(225,29,72,.30) 0%, rgba(225,29,72,.10) 32%, transparent 62%); }
  svg.flow { position: absolute; inset: 0; width: 1200px; height: 630px; }
  .lockup { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .lockup svg { width: 104px; height: 104px; margin-bottom: 22px; }
  .word { font-size: 196px; font-weight: 800; line-height: .95; letter-spacing: -.02em; }
  .word i { color: ${RED}; font-style: normal; }
  .tag { margin-top: 26px; font-size: 46px; font-weight: 700; letter-spacing: -.01em; }
  .tag b { color: ${RED}; font-weight: 700; }
  .sub { margin-top: 16px; font-size: 25px; font-weight: 500; color: #9a9aa3; }
  .url { position: absolute; bottom: 30px; left: 0; right: 0; text-align: center; font-size: 20px; letter-spacing: .16em; color: #6d6d76; }
</style></head><body>
  <div class="glow"></div>
  <svg class="flow" viewBox="0 0 1200 630" fill="none">
    <path d="M-20 478 C 70 450, 150 512, 296 478" stroke="${RED}" stroke-opacity=".55" stroke-width="3"/>
    <path d="M904 478 C 1050 512, 1130 450, 1220 478" stroke="${RED}" stroke-opacity=".55" stroke-width="3"/>
    <path d="M-20 508 C 70 482, 150 540, 296 508" stroke="${RED}" stroke-opacity=".18" stroke-width="2"/>
    <path d="M904 508 C 1050 540, 1130 482, 1220 508" stroke="${RED}" stroke-opacity=".18" stroke-width="2"/>
    <circle cx="60" cy="466" r="6" fill="${RED}"/><circle cx="1140" cy="466" r="6" fill="${RED}"/>
  </svg>
  <div class="lockup">
    <svg viewBox="0 0 100 100">${mark()}</svg>
    <div class="word">zeph<i>.</i></div>
    <div class="tag">Connections that <b>flow.</b></div>
    <div class="sub">Chat, meetings and AI summaries in one place</div>
  </div>
  <div class="url">WWW.ZEPHCHAT.TECH</div>
</body></html>`;
};

(async () => {
  // --- icons -------------------------------------------------------------------------------------------
  write('favicon.svg', Buffer.from(tileSvg(512)));
  const sizes = { 16: 0.8, 32: 0.78, 48: 0.76, 96: 0.74 };
  const icoImages = [];
  for (const [size, scale] of Object.entries(sizes)) {
    const data = await png(tileSvg(512, { scale, radius: 0.2 }), Number(size));
    write(`favicon-${size}.png`, data);
    if (Number(size) <= 48) icoImages.push({ size: Number(size), data });
  }
  write('favicon.ico', ico(icoImages));
  write('apple-touch-icon.png', await png(tileSvg(512, { scale: 0.7, radius: 0 }), 180)); // iOS applies its own rounding
  write('logo192.png', await png(tileSvg(512, { scale: 0.72, radius: 0.22 }), 192));
  write('logo512.png', await png(tileSvg(512, { scale: 0.72, radius: 0.22 }), 512));
  write('logo-maskable-512.png', await png(tileSvg(512, { scale: 0.5, radius: 0 }), 512)); // mark inside the 80% safe zone

  // --- social preview ----------------------------------------------------------------------------------
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.log('playwright not installed: skipped og-zeph-v2.png (npm i --no-save playwright to build it)');
    return;
  }
  const htmlPath = path.join(require('os').tmpdir(), 'zeph-og.html');
  fs.writeFileSync(htmlPath, ogHtml());
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const shot = await page.screenshot({ type: 'png' });
  await browser.close();
  write('og-zeph-v2.png', await sharp(shot).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer());
})();
