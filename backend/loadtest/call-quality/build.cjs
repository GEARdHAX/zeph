// Bundles the REAL browser engine (frontend/src/lib/cloudflareCall.js) for the test page, with
// reactn / the Redux store swapped for stubs. Run before live-e2e.cjs / quality.cjs.
const fs = require('fs');
const path = require('path');
const esbuild = require(path.resolve(__dirname, '../../../frontend/node_modules/esbuild'));

const source = fs
  .readFileSync(path.resolve(__dirname, '../../../frontend/src/lib/cloudflareCall.js'), 'utf8')
  .replace("from 'reactn';", "from './reactn-stub.js';")
  .replace("from '../store';", "from './store-stub.js';");
fs.writeFileSync(path.join(__dirname, 'engine.js'), source);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'main.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(__dirname, 'bundle.js'),
  logLevel: 'error',
});
console.log('bundle.js built from the current cloudflareCall.js');
