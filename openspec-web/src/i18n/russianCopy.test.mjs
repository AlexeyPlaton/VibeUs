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

const read = (...parts) => fs.readFileSync(path.resolve(root, ...parts), 'utf8');

test('Russian copy normalizer covers known untranslated product phrases', () => {
  for (const phrase of forbidden) {
    assert.match(source, escaped(phrase));
  }
  for (const legacyWord of ['тикет', 'баг', 'Канбан', 'эндпоинт', 'middleware', 'деплой', 'краш', 'промпт']) {
    assert.match(source, escaped(legacyWord));
  }
});

test('editorial Russian layer contains no known legacy English labels', () => {
  const editorial = read('editorial.ts');
  const russian = editorial.split('export const editorialRu =')[1] || '';
  for (const phrase of forbidden) {
    assert.doesNotMatch(russian, escaped(phrase));
  }
  assert.doesNotMatch(russian, /\bworkspace\b/i);
  assert.doesNotMatch(russian, /\bdigest\b/i);
  assert.doesNotMatch(russian, /\bviewport\b/i);
});

test('Russian terminology layers use user-facing product language', () => {
  const terminology = read('terminology.ts');
  const russian = terminology.split('export const terminologyRu =')[1] || '';
  for (const phrase of forbidden) {
    assert.doesNotMatch(russian, escaped(phrase));
  }
  assert.match(russian, /Адрес проекта/);
  assert.match(russian, /Открытый ключ виджета/);
  assert.match(russian, /Ключ приёма ошибок/);
  assert.match(russian, /Доска задач/);
  assert.match(russian, /Критерии готовности/);

  const engineering = read('engineeringTerms.ts');
  const engineeringRu = engineering.split('export const engineeringTermsRu =')[1] || '';
  assert.match(engineeringRu, /Уровень инженерной проверки/);
  assert.match(engineeringRu, /Стандартный/);
  assert.match(engineeringRu, /Строгий/);
  assert.match(engineeringRu, /Критический/);
  assert.match(engineeringRu, /Условие успешной проверки/);
});

test('create and dashboard pages do not bypass i18n for product labels', () => {
  const create = read('..', 'pages', 'CreateProjectPage.tsx');
  const dashboard = read('..', 'pages', 'DashboardPage.tsx');

  for (const label of ['>API Token<', '>Public Widget Key<', '>Runtime Ingest Key<', '>SECRET · one-time view<', '>Slug<', '>International · $<', '>CLI<']) {
    assert.doesNotMatch(create, escaped(label));
  }
  for (const label of ['>Workspace<', '>Projects<', '>Public Widget Key<', '>Runtime Ingest Key<', '>API Token<', '>International · $<', '3. Runtime Bridge']) {
    assert.doesNotMatch(dashboard, escaped(label));
  }

  assert.match(create, /v7\.create\.labels\.project_address/);
  assert.match(dashboard, /v7\.dashboard\.labels\.workspace/);
});

test('onboarding, runtime, review and widget surfaces route product vocabulary through i18n', () => {
  const components = path.resolve(root, '..', 'components');
  const onboarding = fs.readFileSync(path.join(components, 'OnboardingGuideModal.tsx'), 'utf8');
  const runtime = fs.readFileSync(path.join(components, 'RuntimeErrorsModal.tsx'), 'utf8');
  const ticket = fs.readFileSync(path.join(components, 'TicketDetailModal.tsx'), 'utf8');
  const widget = fs.readFileSync(path.join(components, 'VibusWidgetUI.tsx'), 'utf8');

  assert.doesNotMatch(onboarding, />Runtime Bridge</);
  assert.match(onboarding, /v7\.onboarding\.tabs\.runtime/);

  assert.doesNotMatch(runtime, /status\.toUpperCase\(\)/);
  assert.doesNotMatch(runtime, />Auto Ticket</);
  assert.doesNotMatch(runtime, />Request ID</);
  assert.match(runtime, /v7\.runtime\.item_status/);
  assert.match(runtime, /v7\.runtime\.detail\.request_id/);

  assert.doesNotMatch(ticket, />Definition of Done \(DoD\)</);
  assert.doesNotMatch(ticket, />VERIFIED</);
  assert.doesNotMatch(ticket, />HUMAN VERIFY</);
  assert.doesNotMatch(ticket, />VERIFYING/);
  assert.doesNotMatch(ticket, />⚡ Critical</);
  assert.match(ticket, /v7\.ticket\.dod\.title/);
  assert.match(ticket, /v7\.ticket\.dod\.human_verify/);

  assert.doesNotMatch(widget, />Powered by</);
  assert.match(widget, /widget\.powered_by/);
});

test('engineering criteria manager localizes its own vocabulary instead of presenting raw English labels', () => {
  const manager = read('..', 'components', 'widget', 'ui', 'DoDManager.tsx');

  for (const literal of ['>AI-Assisted<', '>Engineering Quality<', 'Standard = baseline', '>Security</option>', '>Boundary</option>', '>Spec</option>', '>Backend</option>', 'Verify: {item.requiredTest}', 'Pass: {item.passCondition}']) {
    assert.doesNotMatch(manager, escaped(literal));
  }
  assert.match(manager, /v7\.dod\.quality_title/);
  assert.match(manager, /v7\.dod\.quality\.\$\{mode\}/);
  assert.match(manager, /v7\.dod\.verify_label/);
  assert.match(manager, /v7\.dod\.pass_label/);
});
