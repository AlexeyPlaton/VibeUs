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

test('Russian copy normalizer covers known untranslated product phrases', () => {
  for (const phrase of forbidden) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('editorial Russian layer contains no known legacy English labels', () => {
  const editorial = fs.readFileSync(path.join(root, 'editorial.ts'), 'utf8');
  const russian = editorial.split('export const editorialRu =')[1] || '';
  for (const phrase of forbidden) {
    assert.doesNotMatch(russian, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.doesNotMatch(russian, /\bworkspace\b/i);
  assert.doesNotMatch(russian, /\bdigest\b/i);
  assert.doesNotMatch(russian, /\bviewport\b/i);
});
