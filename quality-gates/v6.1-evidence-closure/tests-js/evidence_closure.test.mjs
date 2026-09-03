import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyCriterion, canAutoReview } from '../../../openspec-cli/criteria-verifier.js';

test('strict BLOCKER cannot auto-review from checkbox claim alone', () => {
  const key = 'Regression proof';
  const ticket = {
    quality_mode: 'strict',
    checklists: { [key]: true },
    criteria_contract: { [key]: { id: 'BASE_REGRESSION_TEST', severity: 'blocker', verification: { adapter: 'node_test', target: 'x.test.mjs' } } },
    criteria_evidence: {},
  };
  assert.equal(canAutoReview(ticket), false);
});

test('self-asserted PASS without contract binding does not unlock strict auto-review', () => {
  const key = 'Regression proof';
  const ticket = {
    quality_mode: 'strict',
    checklists: { [key]: true },
    criteria_contract: { [key]: { id: 'BASE_REGRESSION_TEST', severity: 'blocker', verification: { adapter: 'node_test', target: 'x.test.mjs' } } },
    criteria_evidence: { [key]: { verified: true, result: 'PASS', adapter: 'node_test', receipt_sha256: 'a'.repeat(64) } },
  };
  assert.equal(canAutoReview(ticket), false);
});

test('allowlisted node_test adapter executes a real test and returns evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibus-v61-'));
  fs.writeFileSync(path.join(root, 'proof.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('proof',()=>assert.equal(2+2,4));\n");
  const receipt = await verifyCriterion({ id: 'X', severity: 'blocker', verification: { adapter: 'node_test', target: 'proof.test.mjs' } }, { cwd: root });
  assert.equal(receipt.verified, true);
  assert.equal(receipt.result, 'PASS');
  assert.equal(receipt.exit_code, 0);
  assert.match(receipt.receipt_sha256, /^[0-9a-f]{64}$/);
});

test('unsafe target is blocked and never executed', async () => {
  const receipt = await verifyCriterion({ id: 'X', severity: 'blocker', verification: { adapter: 'node_test', target: '../outside.test.mjs' } });
  assert.equal(receipt.verified, false);
  assert.equal(receipt.result, 'BLOCKED');
});
