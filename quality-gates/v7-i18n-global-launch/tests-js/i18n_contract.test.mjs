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

const en = flatten(json('openspec-web/src/i18n/locales/en.json'));
const ru = flatten(json('openspec-web/src/i18n/locales/ru.json'));

test('EN and RU shipping locales have exact key parity', () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  assert.ok(Object.keys(en).length >= 1000, 'unexpectedly small canonical locale');
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

test('all static translation calls resolve in EN/RU and use semantic non-Cyrillic keys', () => {
  const re = /\b(?:t18n|tr|t|i18n\.t)\(\s*['"]([^'"]+)['"]/g;
  for (const file of walk(src).filter((p) => /\.tsx?$/.test(p))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(re)) {
      const key = match[1];
      assert.doesNotMatch(key, /[А-Яа-яЁё]/, `${file}: Cyrillic key ${key}`);
      assert.ok(Object.hasOwn(en, key), `${file}: EN missing ${key}`);
      assert.ok(Object.hasOwn(ru, key), `${file}: RU missing ${key}`);
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
