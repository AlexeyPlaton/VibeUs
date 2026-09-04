import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const src = path.join(root, 'openspec-web', 'src');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

function flatten(value, prefix = '', out = {}) {
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, name, out);
    else out[name] = item;
  }
  return out;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function objectLiteral(source, exportName) {
  const marker = new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*\\{`);
  const match = marker.exec(source);
  assert.ok(match, `missing export const ${exportName}`);
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`unterminated object export ${exportName}`);
}

function objectLeafPaths(source, exportName) {
  const block = objectLiteral(source, exportName).slice(1, -1);
  const stack = [];
  const leaves = new Set();
  const propRe = /^(?:(['"])(.*?)\1|([A-Za-z_$][A-Za-z0-9_$]*))\s*:\s*(.*)$/;
  for (const raw of block.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    while (line.startsWith('}')) {
      if (stack.length) stack.pop();
      line = line.slice(1).replace(/^[\s,]+/, '');
    }
    if (!line) continue;
    const match = propRe.exec(line);
    if (!match) continue;
    const key = match[1] ? match[2] : match[3];
    const value = match[4].trim();
    if (value.startsWith('{')) stack.push(key);
    else leaves.add([...stack, key].join('.'));
  }
  return leaves;
}

const baseEn = flatten(json('openspec-web/src/i18n/locales/en.json'));
const baseRu = flatten(json('openspec-web/src/i18n/locales/ru.json'));
const effectiveEn = new Set(Object.keys(baseEn));
const effectiveRu = new Set(Object.keys(baseRu));
const layered = [
  ['openspec-web/src/i18n/v8.ts', 'v8En', 'v8Ru'],
  ['openspec-web/src/i18n/editorial.ts', 'editorialEn', 'editorialRu'],
  ['openspec-web/src/i18n/terminology.ts', 'terminologyEn', 'terminologyRu'],
  ['openspec-web/src/i18n/engineeringTerms.ts', 'engineeringTermsEn', 'engineeringTermsRu'],
  ['openspec-web/src/i18n/enterpriseTerms.ts', 'enterpriseTermsEn', 'enterpriseTermsRu'],
  ['openspec-web/src/i18n/productRadarTerms.ts', 'productRadarTermsEn', 'productRadarTermsRu'],
];
for (const [file, enExport, ruExport] of layered) {
  const source = read(file);
  for (const key of objectLeafPaths(source, enExport)) effectiveEn.add(key);
  for (const key of objectLeafPaths(source, ruExport)) effectiveRu.add(key);
}

test('EN and RU shipping locales have exact effective key parity', () => {
  assert.deepEqual(Object.keys(baseRu).sort(), Object.keys(baseEn).sort(), 'base locale JSON must stay symmetric');
  assert.deepEqual([...effectiveRu].sort(), [...effectiveEn].sort(), 'layered effective locales must stay symmetric');
  assert.ok(effectiveEn.size >= 1000, 'unexpectedly small effective locale');
});

test('English is the only fallback/default for unknown browsers', () => {
  const cfg = read('openspec-web/src/i18n/config.ts');
  assert.match(cfg, /SUPPORTED_UI_LOCALES\s*=\s*\['en',\s*'ru'\]/);
  assert.match(cfg, /fallbackLng:\s*'en'/);
  assert.match(cfg, /return\s+'en';/);
  assert.doesNotMatch(cfg, /fallbackLng:\s*'ru'/);
  assert.doesNotMatch(cfg, /import\s+zh\s+from/);
  assert.doesNotMatch(cfg, /import\s+hi\s+from/);
  assert.match(cfg, /document\.documentElement\.lang/);
});

test('incomplete ZH/HI dictionaries are retained but not exposed as runtime languages', () => {
  assert.ok(fs.existsSync(path.join(src, 'i18n/locales/zh.json')));
  assert.ok(fs.existsSync(path.join(src, 'i18n/locales/hi.json')));
  const constants = read('openspec-web/src/components/widget/constants.ts');
  assert.doesNotMatch(constants, /code:\s*'zh'/);
  assert.doesNotMatch(constants, /code:\s*'hi'/);
  assert.match(constants, /code:\s*'en'/);
  assert.match(constants, /code:\s*'ru'/);
});

test('all static translation calls resolve in effective EN/RU and use semantic non-Cyrillic keys', () => {
  const re = /\b(?:t18n|tr|t|i18n\.t)\(\s*['"]([^'"]+)['"]/g;
  for (const file of walk(src).filter((p) => /\.tsx?$/.test(p))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(re)) {
      const key = match[1];
      assert.doesNotMatch(key, /[А-Яа-яЁё]/, `${file}: Cyrillic key ${key}`);
      assert.ok(effectiveEn.has(key), `${file}: EN missing ${key}`);
      assert.ok(effectiveRu.has(key), `${file}: RU missing ${key}`);
    }
  }
});

test('landing is English-first and pricing utility contains no localized Russian copy', () => {
  const html = read('openspec-web/index.html');
  assert.match(html, /<html lang="en">/);
  assert.doesNotMatch(html, /[А-Яа-яЁё]/);
  const pricing = read('openspec-web/src/utils/pricing.ts');
  assert.doesNotMatch(pricing, /[А-Яа-яЁё]/);
  assert.doesNotMatch(pricing, /дней|актуальная цена/);
});

test('major launch surfaces contain no hardcoded Cyrillic UI', () => {
  const files = [
    'openspec-web/src/pages/LandingPage.tsx',
    'openspec-web/src/pages/CreateProjectPage.tsx',
    'openspec-web/src/pages/DashboardPage.tsx',
    'openspec-web/src/pages/legalpage.tsx',
    'openspec-web/src/components/RuntimeErrorsModal.tsx',
    'openspec-web/src/components/OnboardingGuideModal.tsx',
    'openspec-web/src/components/widget/ui/SettingsPanel.tsx',
    'openspec-web/src/components/widget/ui/DoDManager.tsx',
  ];
  for (const file of files) assert.doesNotMatch(read(file), /[А-Яа-яЁё]/, file);
});
