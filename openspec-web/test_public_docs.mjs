import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '..');
const readRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const readWeb = (relative) => fs.readFileSync(path.join(webRoot, relative), 'utf8');

test('public repository links keep exact Git casing and expose verified support', () => {
  const readme = readRepo('README.md');
  assert.match(readme, /docs\/WIDGET_INTEGRATION\.md/);
  assert.match(readme, /docs\/SELF_HOSTING\.md/);
  assert.match(readme, /docs\/API\.md/);
  assert.doesNotMatch(readme, /docs\/(?:widget_integration|self_hosting|api)\.md/);
  assert.match(readme, /support@vibeus\.pro/);
});

test('self-hosting quick start builds frontend before compose and documents actual ports', () => {
  const guide = readRepo('docs/SELF_HOSTING.md');
  assert.match(guide, /AlexeyPlaton\/VibeUs\.git/);
  assert.doesNotMatch(guide, /AlexeyPlaton\/Vibus\.git/);
  assert.match(guide, /npm ci[\s\S]*npm run build:all[\s\S]*docker compose up -d --build/);
  assert.match(guide, /Web UI:\s*`http:\/\/localhost`/);
  assert.match(guide, /API direct:\s*`http:\/\/localhost:8000`/);
  assert.match(guide, /API readiness:\s*`http:\/\/localhost:8000\/ready`/);
  assert.doesNotMatch(guide, /`SECRET_KEY`\s*\|\s*\*\*Yes\*\*/);
  assert.match(guide, /support@vibeus\.pro/);
});

test('production examples default to the guarded CloudPayments path', () => {
  for (const file of ['.env.production.example', 'deploy/env.production.example']) {
    const env = readRepo(file);
    assert.match(env, /GLOBAL_BILLING_PROVIDER=cloudpayments/);
    assert.match(env, /ENABLE_CLOUDPAYMENTS=false/);
    assert.match(env, /CLOUDPAYMENTS_PUBLIC_ID=/);
    assert.match(env, /CLOUDPAYMENTS_API_SECRET=/);
    assert.match(env, /CLOUDPAYMENTS_API_BASE_URL=https:\/\/api\.cloudpayments\.ru/);
  }

  const billing = readRepo('docs/INTERNATIONAL_BILLING_RU.md');
  assert.match(billing, /GLOBAL_BILLING_PROVIDER=cloudpayments/);
  assert.match(billing, /cloudpayments\/check/);
  assert.match(billing, /cloudpayments\/pay/);
  assert.match(billing, /cloudpayments\/fail/);
  assert.match(billing, /cloudpayments\/refund/);
  assert.match(billing, /ENABLE_CLOUDPAYMENTS=false/);
});

test('GitHub App onboarding and preview safety stay documented in public deployment templates', () => {
  for (const file of ['.env.example', '.env.production.example', 'deploy/env.production.example']) {
    const env = readRepo(file);
    assert.match(env, /GITHUB_APP_ID=/);
    assert.match(env, /GITHUB_APP_SLUG=/);
    assert.match(env, /GITHUB_APP_PRIVATE_KEY_B64=/);
    assert.match(env, /GITHUB_APP_STATE_SECRET=/);
    assert.match(env, /GITHUB_APP_SETUP_URL=/);
  }

  const orchestration = readRepo('docs/AI_ORCHESTRATION.md');
  assert.match(orchestration, /github\/app\/install-intent/);
  assert.match(orchestration, /api\/github\/app\/install\/complete/);
  assert.match(orchestration, /does \*\*not\*\* accept `installation_id`/i);
  assert.match(orchestration, /automation\/preview\/deploy/);
  assert.match(orchestration, /production_environment=false/);
  assert.match(orchestration, /render-preview/);
  assert.match(orchestration, /There is no preview `production`, `promote`, `release`/);
});

test('confirmed support mailbox is available across public support surfaces', () => {
  assert.match(readRepo('SECURITY.md'), /support@vibeus\.pro/);
  assert.match(readRepo('docs/B2B_INVOICE_GUIDE_RU.md'), /support@vibeus\.pro/);
  assert.match(readRepo('docs/INTERNATIONAL_BILLING_RU.md'), /support@vibeus\.pro/);
  assert.match(readWeb('src/pages/legalpage.tsx'), /mailto:support@vibeus\.pro/);
});
