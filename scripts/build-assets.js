'use strict';
// Build only from exact lockfile dependencies, never from runtime CDNs.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
fs.mkdirSync('vendor', { recursive: true });
const copies = [
  ['node_modules/lucide/LICENSE', 'vendor/lucide-LICENSE.txt'],
  ['node_modules/tesseract.js/LICENSE.md', 'vendor/tesseract-LICENSE.txt'],
  ['node_modules/tesseract.js-core/LICENSE', 'vendor/tesseract-core-LICENSE.txt'],
  ['node_modules/lucide/dist/umd/lucide.min.js', 'vendor/lucide.min.js'],
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'vendor/tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'vendor/worker.min.js'],
  ['node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz', 'vendor/por.traineddata.gz']
];
for (const file of fs.readdirSync('node_modules/tesseract.js-core')) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(file)) copies.push(['node_modules/tesseract.js-core/' + file, 'vendor/' + file]);
}
for (const [source, destination] of copies) fs.copyFileSync(source, destination);
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'styles/input.css', '-o', 'vendor/app.css',
  '--minify', '--content', './index.html,./app.js,./score-ui.js,./remote-ui.js'], { stdio: 'pipe' });
const files = ['vendor/app.css', ...copies.map(row => row[1])].sort();
const manifest = files.map(file => ({ file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), bytes: fs.statSync(file).size }));
fs.writeFileSync('vendor/manifest.json', JSON.stringify({ files: manifest }, null, 2) + '\n');
console.log(`Built ${files.length} same-origin assets with SHA-256 inventory.`);
