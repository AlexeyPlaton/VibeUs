import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.md'];
const issues = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (/\.(ts|tsx)$/.test(name)) checkFile(file);
  }
}

function exactExists(candidate) {
  const parent = path.dirname(candidate);
  if (!fs.existsSync(parent)) return false;
  const base = path.basename(candidate);
  return fs.readdirSync(parent).includes(base);
}

function resolvesExactly(file, spec) {
  const clean = spec.split('?')[0];
  const base = path.resolve(path.dirname(file), clean);
  if (path.extname(base)) return exactExists(base);
  for (const ext of sourceExts) if (exactExists(base + ext)) return true;
  for (const ext of sourceExts) if (exactExists(path.join(base, 'index' + ext))) return true;
  return false;
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const patterns = [
    /\bfrom\s*['"](\.[^'"]+)['"]/g,
    /^\s*import\s*['"](\.[^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const spec = match[1];
      if (!resolvesExactly(file, spec)) issues.push(`${path.relative(root, file)} -> ${spec}`);
    }
  }
}

walk(root);
if (issues.length) {
  console.error('Case-sensitive relative import failures:\n' + [...new Set(issues)].join('\n'));
  process.exit(1);
}
console.log('case_sensitive_imports=PASS');
