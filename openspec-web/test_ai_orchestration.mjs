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

test('delivery integrations are account-scoped, GitHub-App first, and expose observe-only preview adapters', () => {
  const app = read('src/App.tsx');
  const board = read('src/components/ProjectBoardModal.tsx');
  const page = read('src/pages/DeliveryIntegrationsPage.tsx');

  assert.match(app, /\/app\/integrations\/:projectSlug/);
  assert.match(app, /DeliveryIntegrationsPage/);
  assert.match(board, /data-board-delivery-integrations/);
  assert.match(page, /github\/app\/connect/);
  assert.match(page, /github\/app\/test/);
  assert.match(page, /github\/pat/);
  assert.match(page, /automation\/preview/);
  assert.match(page, /value="github"/);
  assert.match(page, /value="vercel"/);
  assert.match(page, /value="render"/);
  assert.doesNotMatch(page, /preview\/deploy/);
  assert.doesNotMatch(page, /method:\s*['"]POST['"].*deploy/);
});

test('account ticket details get a native direct AI entry while standalone widget remains unchanged', () => {
  const context = read('src/components/TicketAiContext.tsx');
  const modal = read('src/components/TicketDetailModal.tsx');
  const page = read('src/pages/AIOrchestrationPage.tsx');
  const main = read('src/main.tsx');
  const widget = read('src/widget.tsx');
  const board = read('src/components/ProjectBoardModal.tsx');

  assert.match(context, /createContext/);
  assert.match(context, /projectSlug/);
  assert.match(board, /TicketAiProvider/);
  assert.match(modal, /useTicketAiContext/);
  assert.match(modal, /data-ticket-ai-entry/);
  assert.match(modal, /v7\.ticket\.work_with_ai/);
  assert.match(modal, /\?ticket=/);
  assert.match(page, /URLSearchParams/);
  assert.match(page, /requestedTicket/);
  assert.doesNotMatch(main, /accountTicketAiBridge/);
  assert.doesNotMatch(widget, /TicketAiProvider|TicketAiContext|accountTicketAiBridge/);
});

test('English and Russian orchestration and delivery terms remain layered symmetrically', () => {
  const terms = read('src/i18n/enterpriseTerms.ts');

  for (const key of [
    'generate_handoff',
    'dispatch_agent',
    'guardrail_branch',
    'guardrail_evidence',
    'guardrail_review',
    'status_repair_blocked',
    'webhook_title',
    'delivery_integrations',
    'work_with_ai',
    'github_title',
    'preview_title',
    'observe_only_desc',
  ]) {
    const matches = terms.match(new RegExp(`${key}:`, 'g')) || [];
    assert.equal(matches.length, 2, `${key} must exist in EN and RU enterprise layers`);
  }
});