import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
const control = readFileSync(new URL('./src/pages/ControlCenterPage.tsx', import.meta.url), 'utf8');

test('founder control is a separate top-level route', () => {
  assert.match(app, /path="\/control"/);
  assert.match(app, /ControlCenterPage/);
  assert.doesNotMatch(app, /EnterpriseDashboardFrame><ControlCenterPage/);
});

test('control UI requires explicit step-up for sensitive actions', () => {
  assert.match(control, /\/api\/control\/elevate/);
  assert.match(control, /Sensitive actions are locked/);
  assert.match(control, /Unlock sensitive actions with your password first/);
  assert.match(control, /\/api\/control\/elevation\/revoke/);
});

test('promo plaintext is one-time and secret project credentials are never rendered', () => {
  assert.match(control, /Visible once/);
  assert.match(control, /Code hidden by design/);
  assert.match(control, /api_token_configured/);
  assert.match(control, /ingest_key_configured/);
  assert.doesNotMatch(control, /project\.api_token\b/);
  assert.doesNotMatch(control, /project\.ingest_key\b/);
});

test('unfinished high-risk functionality remains explicit TODO rather than fake mutations', () => {
  assert.match(control, /Provider mutations are intentionally disabled/);
  assert.match(control, /TODO · provider-side refund\/cancel adapter/);
  assert.match(control, /Post-MVP capabilities are intentionally visible, not fake/);
  assert.match(control, /\/api\/control\/roadmap/);
});
