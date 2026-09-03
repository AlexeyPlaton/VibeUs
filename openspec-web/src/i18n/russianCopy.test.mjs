import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);
const source = fs.readFileSync(path.join(root, 'russianCopy.ts'), 'utf8');

const forbidden = [
  'Runtime Error Tracking',
  'Runtime Error Bridge',
  'Runtime Ingest Key',
  'Public Widget Key',
  'Founding Access',
  'International billing',
  'Definition of Done',
  'Live Preview',
  'Self-Hosted',
  'Call Stack',
];

const escaped = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

test('Russian copy normalizer covers known untranslated product phrases', () => {
  for (const phrase of forbidden) {
    assert.match(source, escaped(phrase));
  }
  for (const legacyWord of ['тикет', 'баг', 'Канбан', 'эндпоинт', 'middleware', 'деплой', 'краш', 'промпт']) {
    assert.match(source, escaped(legacyWord));
  }
});

test('editorial Russian layer contains no known legacy English labels', () => {
  const editorial = fs.readFileSync(path.join(root, 'editorial.ts'), 'utf8');
  const russian = editorial.split('export const editorialRu =')[1] || '';
  for (const phrase of forbidden) {
    assert.doesNotMatch(russian, escaped(phrase));
  }
  assert.doesNotMatch(russian, /\bworkspace\b/i);
  assert.doesNotMatch(russian, /\bdigest\b/i);
  assert.doesNotMatch(russian, /\bviewport\b/i);
});

test('Russian terminology layer uses user-facing product language', () => {
  const terminology = fs.readFileSync(path.join(root, 'terminology.ts'), 'utf8');
  const russian = terminology.split('export const terminologyRu =')[1] || '';
  for (const phrase of forbidden) {
    assert.doesNotMatch(russian, escaped(phrase));
  }
  assert.match(russian, /Адрес проекта/);
  assert.match(russian, /Открытый ключ виджета/);
  assert.match(russian, /Ключ приёма ошибок/);
  assert.match(russian, /Доска задач/);
});

test('create and dashboard pages do not bypass i18n for product labels', () => {
  const pagesRoot = path.resolve(root, '..', 'pages');
  const create = fs.readFileSync(path.join(pagesRoot, 'CreateProjectPage.tsx'), 'utf8');
  const dashboard = fs.readFileSync(path.join(pagesRoot, 'DashboardPage.tsx'), 'utf8');

  for (const label of ['>API Token<', '>Public Widget Key<', '>Runtime Ingest Key<', '>SECRET · one-time view<', '>Slug<', '>International · $<', '>CLI<']) {
    assert.doesNotMatch(create, escaped(label));
  }
  for (const label of ['>Workspace<', '>Projects<', '>Public Widget Key<', '>Runtime Ingest Key<', '>API Token<', '>International · $<', '3. Runtime Bridge']) {
    assert.doesNotMatch(dashboard, escaped(label));
  }

  assert.match(create, /v7\.create\.labels\.project_address/);
  assert.match(dashboard, /v7\.dashboard\.labels\.workspace/);
});
