#!/usr/bin/env node
// Bundle-size benchmark: runs the real production build and summarizes JS/CSS output
// size (raw + gzip) so bundle-size regressions/improvements are a number, not a guess.
// Reuses `vite build`'s own reporting rather than re-implementing size calculation.
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

console.log('Building production bundle...\n');
execSync('npx vite build', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
};

const files = walk(distDir).filter((f) => /\.(js|css)$/.test(f));
const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
const jsBytes = files.filter((f) => f.endsWith('.js')).reduce((sum, f) => sum + fs.statSync(f).size, 0);
const cssBytes = files.filter((f) => f.endsWith('.css')).reduce((sum, f) => sum + fs.statSync(f).size, 0);

console.log('\n--- Bundle summary ---');
console.log(`JS:    ${(jsBytes / 1024).toFixed(1)} KB (raw)`);
console.log(`CSS:   ${(cssBytes / 1024).toFixed(1)} KB (raw)`);
console.log(`Total: ${(totalBytes / 1024).toFixed(1)} KB (raw, gzip figures above from vite's own output)`);
console.log('\nRe-run after dependency or code-splitting changes to compare against these numbers.');
