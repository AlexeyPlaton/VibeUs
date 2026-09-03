import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const dist = path.join(webRoot, 'dist-widget');
const coreStatic = path.resolve(webRoot, '..', 'openspec-core', 'static');

const expected = [
  ['vibus-widget.umd.cjs', 'vibus-widget.umd.cjs'],
  ['vibus-widget.css', 'vibus-widget.css'],
];

fs.mkdirSync(coreStatic, { recursive: true });
const manifest = {
  schema: 1,
  generated_at: new Date().toISOString(),
  build_mode: 'widget',
  files: {},
};

for (const [srcName, dstName] of expected) {
  const src = path.join(dist, srcName);
  if (!fs.existsSync(src)) {
    throw new Error(`Expected widget build artifact is missing: ${src}`);
  }
  const bytes = fs.readFileSync(src);
  if (bytes.length < 256) {
    throw new Error(`Widget build artifact is suspiciously small: ${srcName} (${bytes.length} bytes)`);
  }
  const dst = path.join(coreStatic, dstName);
  fs.writeFileSync(dst, bytes);
  manifest.files[dstName] = {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

fs.writeFileSync(
  path.join(coreStatic, 'widget-build-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(`Synced widget artifacts to ${coreStatic}`);
