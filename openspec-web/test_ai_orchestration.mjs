import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('AI orchestration route is account-scoped and discoverable from the project board', () => {
  const app = read('src/App.tsx');
  const board = read('src/components/ProjectBoardModal.tsx');

  assert.match(app, /\/app\/ai\/:projectSlug/);
  assert.match(app, /AIOrchestrationPage/);
  assert.match(board, /data-board-ai-orchestration/);
  assert.match(board, /\/app\/ai\/\$\{encodeURIComponent\(project\.slug\)\}/);
});

test('Web AI bridge is provider-agnostic and uses VIBEUS-PATCH instead of model-specific write access', () => {
  const page = read('src/pages/AIOrchestrationPage.tsx');

  assert.match(page, /web_ai/);
  assert.match(page, /jules/);
  assert.match(page, /github_label_agent/);
  assert.match(page, /external_agent/);
  assert.match(page, /VIBEUS-PATCH v1/);
  assert.match(page, /ai\/handoff/);
  assert.match(page, /ai\/apply-patch/);
  assert.match(page, /ai\/link-pr/);
});

test('UI keeps merge and final acceptance out of the automation surface', () => {
  const page = read('src/pages/AIOrchestrationPage.tsx');

  assert.doesNotMatch(page, /\/ai\/merge/);
  assert.doesNotMatch(page, /\/automation\/merge/);
  assert.match(page, /guardrail_review/);
  assert.match(page, /guardrail_evidence/);
});

test('orchestration policy exposes bounded repair, CI, preview and signed webhook setup', () => {
  const page = read('src/pages/AIOrchestrationPage.tsx');

  assert.match(page, /max_repair_attempts/);
  assert.match(page, /observe_ci/);
  assert.match(page, /observe_preview/);
  assert.match(page, /webhook-secret\/rotate/);
  assert.match(page, /webhook_url/);
});

test('English and Russian orchestration terms remain layered symmetrically', () => {
  const terms = read('src/i18n/enterpriseTerms.ts');

  for (const key of [
    'generate_handoff',
    'dispatch_agent',
    'guardrail_branch',
    'guardrail_evidence',
    'guardrail_review',
    'status_repair_blocked',
    'webhook_title',
  ]) {
    const matches = terms.match(new RegExp(`${key}:`, 'g')) || [];
    assert.equal(matches.length, 2, `${key} must exist in EN and RU enterprise layers`);
  }
});
