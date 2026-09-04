import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
const control = readFileSync(new URL('./src/pages/ControlCenterPage.tsx', import.meta.url), 'utf8');
const radar = readFileSync(new URL('./src/pages/ProductRadarPage.tsx', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('./src/pages/FounderWorkbenchPage.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./src/components/FounderControlShell.tsx', import.meta.url), 'utf8');

test('founder cockpit is separate from normal account RBAC and has one shared founder navigation shell', () => {
  assert.match(app, /path="\/control" element={<FounderControlShell><ProductRadarPage/);
  assert.match(app, /path="\/control\/workbench" element={<FounderControlShell><FounderWorkbenchPage/);
  assert.match(app, /path="\/control\/ops" element={<FounderControlShell><ControlCenterPage/);
  assert.match(shell, /Launch & Growth/);
  assert.match(shell, /Operations/);
  assert.doesNotMatch(app, /EnterpriseDashboardFrame><ProductRadarPage/);
  assert.doesNotMatch(app, /EnterpriseDashboardFrame><ControlCenterPage/);
});

test('control UI requires explicit step-up for sensitive actions', () => {
  assert.match(control, /\/api\/control\/elevate/);
  assert.match(control, /Sensitive actions are locked/);
  assert.match(control, /Unlock sensitive actions with your password first/);
  assert.match(control, /\/api\/control\/elevation\/revoke/);
  assert.match(workbench, /\/api\/control\/elevate/);
  assert.match(workbench, /step-up required/);
});

test('promo plaintext is one-time and secret project credentials are never rendered', () => {
  assert.match(control, /Visible once/);
  assert.match(control, /Code hidden by design/);
  assert.match(control, /api_token_configured/);
  assert.match(control, /ingest_key_configured/);
  assert.doesNotMatch(control, /project\.api_token\b/);
  assert.doesNotMatch(control, /project\.ingest_key\b/);
});

test('former post-MVP founder surfaces are real while external high-risk dependencies remain explicit', () => {
  assert.match(workbench, /Launch checklist/);
  assert.match(workbench, /Customer 360/);
  assert.match(workbench, /Cross-project Error Center/);
  assert.match(workbench, /Payment reconciliation/);
  assert.match(workbench, /Privacy data-request case management/);
  assert.match(workbench, /Cohorts & founder funnel/);
  assert.match(workbench, /Feature flags/);
  assert.match(workbench, /Announcements/);
  assert.match(workbench, /Read-only customer diagnostic/);
  assert.match(workbench, /blocked/);
  assert.match(workbench, /WebAuthn/);
  assert.match(workbench, /provider-side refund/);
  assert.match(control, /Provider mutations are intentionally disabled/);
});

test('founder workbench keeps a persistent launch checklist and a live AI-readable markdown handoff', () => {
  assert.match(workbench, /\/api\/control\/launch-checklist/);
  assert.match(workbench, /\/api\/control\/briefing\.md/);
  assert.match(workbench, /Copy live AI brief/);
  assert.match(workbench, /Where and how to publish VibeUs/);
  assert.match(workbench, /todo/);
  assert.match(workbench, /preparing/);
  assert.match(workbench, /published/);
  assert.match(workbench, /skipped/);
});

test('product radar puts north-star, steering queue and data confidence before vanity metrics', () => {
  assert.match(radar, /\/api\/control\/radar/);
  assert.match(radar, /v7\.product_radar\.north_star_name/);
  assert.match(radar, /v7\.product_radar\.steering_title/);
  assert.match(radar, /v7\.product_radar\.instrument_quality/);
  assert.match(radar, /v7\.product_radar\.launch_guardrails/);
  assert.match(radar, /\/control\/ops/);
  assert.match(radar, /v7\.product_radar\.readonly/);
});
