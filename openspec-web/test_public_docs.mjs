import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '..');
const readRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const readWeb = (relative) => fs.readFileSync(path.join(webRoot, relative), 'utf8');
const existsRepo = (relative) => fs.existsSync(path.join(repoRoot, relative));

test('public README is product-first and links to stable public docs', () => {
  const readme = readRepo('README.md');
  for (const doc of [
    'docs/WIDGET_INTEGRATION.md',
    'docs/SELF_HOSTING.md',
    'docs/API.md',
    'docs/ARCHITECTURE.md',
    'docs/TESTING.md',
    'docs/BILLING.md',
  ]) {
    assert.match(readme, new RegExp(doc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(readme, /support@vibeus\.pro/);
  assert.match(readme, /human acceptance/i);
  assert.doesNotMatch(readme, /Quality Gate v[0-9]/i);
  assert.doesNotMatch(readme, /Founder Control|Product Radar|Growth Strategy/i);
});

test('self-hosting quick start builds frontend before compose and documents actual ports', () => {
  const guide = readRepo('docs/SELF_HOSTING.md');
  assert.match(guide, /AlexeyPlaton\/VibeUs\.git/);
  assert.doesNotMatch(guide, /AlexeyPlaton\/Vibus\.git/);
  assert.match(guide, /npm ci[\s\S]*npm run build:all[\s\S]*docker compose up -d --build/);
  assert.match(guide, /Web UI:\s*`http:\/\/localhost`/);
  assert.match(guide, /API direct:\s*`http:\/\/localhost:8000`/);
  assert.match(guide, /API readiness:\s*`http:\/\/localhost:8000\/ready`/);
  assert.match(guide, /support@vibeus\.pro/);
});

test('public production examples keep live payment providers fail-closed', () => {
  for (const file of ['.env.production.example', 'deploy/env.production.example']) {
    const env = readRepo(file);
    assert.match(env, /ENABLE_GLOBAL_PRICING=false/);
    assert.match(env, /ENABLE_YOOKASSA=false/);
    assert.match(env, /ENABLE_CLOUDPAYMENTS=false/);
    assert.match(env, /ENABLE_STRIPE=false/);
    assert.match(env, /ENABLE_LAVA=false/);
    assert.doesNotMatch(env, /PLATFORM_ADMIN_EMAILS|ENABLE_CONTROL_CENTER|CONTROL_ELEVATION_MINUTES/);
  }

  const billing = readRepo('docs/BILLING.md');
  assert.match(billing, /browser success\/return URL is not authoritative/i);
  assert.match(billing, /operator runbooks/i);
  assert.doesNotMatch(billing, /canonical hosted international adapter/i);
});

test('private operator material is not shipped as current public documentation', () => {
  for (const file of [
    'docs/FOUNDER_AI_BRIEFING.md',
    'docs/FOUNDER_CONTROL.md',
    'docs/FOUNDER_GROWTH_STRATEGY.md',
    'docs/INTERNATIONAL_E2E_LEGAL_AUDIT_2026-09-03.md',
    'docs/INTERNATIONAL_BILLING_RU.md',
    'docs/B2B_INVOICE_GUIDE_RU.md',
  ]) {
    assert.equal(existsRepo(file), false, `${file} must stay out of the public release tree`);
  }
});

test('architecture and testing docs explain behavior without internal gate-version branding', () => {
  const architecture = readRepo('docs/ARCHITECTURE.md');
  const testing = readRepo('docs/TESTING.md');
  assert.match(architecture, /feedback\/error.*task.*Review.*human acceptance/is);
  assert.match(architecture, /Public Widget Keys/i);
  assert.match(testing, /Prefer a test that observes behavior/i);
  assert.match(testing, /quality-gates\//);
  assert.doesNotMatch(testing, /Quality Gate v[0-9]/i);
});

test('GitHub App onboarding and preview safety stay documented', () => {
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
  assert.match(orchestration, /There is no preview `production`, `promote`, `release`/);
});

test('confirmed support mailbox remains on public support surfaces', () => {
  assert.match(readRepo('SECURITY.md'), /support@vibeus\.pro/);
  assert.match(readRepo('README.md'), /support@vibeus\.pro/);
  assert.match(readWeb('src/pages/legalpage.tsx'), /mailto:support@vibeus\.pro/);
});
