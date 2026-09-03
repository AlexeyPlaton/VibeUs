import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canAutoReview,
  contractFingerprint,
  receiptMatchesContract,
  verifyCriterion,
} from '../../../openspec-cli/criteria-verifier.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function resign(receipt) {
  const { receipt_sha256: _old, ...unsigned } = receipt;
  return { ...unsigned, receipt_sha256: crypto.createHash('sha256').update(JSON.stringify(stable(unsigned))).digest('hex') };
}

const key = 'Refund ledger proof';
const contract = {
  id: 'BILLING_REFUND_LEDGER',
  severity: 'blocker',
  requirement: 'Refund accounting remains durable and idempotent.',
  verification: { adapter: 'node_test', target: 'proof.test.mjs', passCondition: 'The regression test exits with code 0.' },
};


test('contract fingerprint is stable across JS and backend canonicalization', () => {
  const parityContract = { id: 'BILLING_REFUND_LEDGER', severity: 'blocker', requirement: 'Refund accounting remains durable and idempotent.', verification: { adapter: 'pytest', target: 'tests/test_refund.py::test_refund', passCondition: 'pytest exits 0' } };
  assert.equal(contractFingerprint(key, parityContract), '8e36db4591ac669bf2ef190d4b654bde8c2b532a6b5c06551e48661e72ff3ce6');
});

test('real verifier receipt is contract-bound and unlocks Strict review', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibus-v62-'));
  fs.writeFileSync(path.join(root, 'proof.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('proof',()=>assert.equal(2+2,4));\n");
  const receipt = await verifyCriterion(contract, { cwd: root, criterionKey: key });
  assert.equal(receipt.verified, true);
  assert.equal(receipt.exit_code, 0);
  assert.equal(receipt.criterion_key, key);
  assert.equal(receipt.contract_sha256, contractFingerprint(key, contract));
  assert.equal(receiptMatchesContract(key, contract, receipt), true);
  assert.equal(canAutoReview({ quality_mode: 'strict', checklists: { [key]: true }, criteria_contract: { [key]: contract }, criteria_evidence: { [key]: receipt } }), true);
});

test('legacy or arbitrary 64-hex digest is not evidence', () => {
  const receipt = { verified: true, result: 'PASS', adapter: 'node_test', target: 'proof.test.mjs', receipt_sha256: 'a'.repeat(64) };
  assert.equal(receiptMatchesContract(key, contract, receipt), false);
});

test('self-consistent receipt with substituted adapter is rejected', () => {
  const receipt = resign({
    criterion_key: key, criterion_id: contract.id, contract_sha256: contractFingerprint(key, contract), provenance: 'local_cli',
    adapter: 'file_exists', target: 'README.md', verifier: 'vibus-cli-v6.2', verified: true, result: 'PASS', exit_code: 0, timed_out: false,
  });
  assert.equal(receiptMatchesContract(key, contract, receipt), false);
});

test('self-consistent receipt with substituted target is rejected', () => {
  const receipt = resign({
    criterion_key: key, criterion_id: contract.id, contract_sha256: contractFingerprint(key, contract), provenance: 'local_cli',
    adapter: 'node_test', target: 'different.test.mjs', verifier: 'vibus-cli-v6.2', verified: true, result: 'PASS', exit_code: 0, timed_out: false,
  });
  assert.equal(receiptMatchesContract(key, contract, receipt), false);
});

test('wrong criterion id or key is rejected even with a recomputed digest', () => {
  for (const changed of [
    { criterion_key: 'Other proof', criterion_id: contract.id },
    { criterion_key: key, criterion_id: 'OTHER_ID' },
  ]) {
    const receipt = resign({
      ...changed, contract_sha256: contractFingerprint(key, contract), provenance: 'local_cli', adapter: 'node_test', target: 'proof.test.mjs',
      verifier: 'vibus-cli-v6.2', verified: true, result: 'PASS', exit_code: 0, timed_out: false,
    });
    assert.equal(receiptMatchesContract(key, contract, receipt), false);
  }
});

test('stale receipt cannot be replayed after the criterion contract changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibus-v62-stale-'));
  fs.writeFileSync(path.join(root, 'proof.test.mjs'), "import test from 'node:test'; test('proof',()=>{});\n");
  const receipt = await verifyCriterion(contract, { cwd: root, criterionKey: key });
  const changed = { ...contract, requirement: `${contract.requirement} Also prove cumulative partial refunds.` };
  assert.notEqual(contractFingerprint(key, changed), receipt.contract_sha256);
  assert.equal(receiptMatchesContract(key, changed, receipt), false);
});

test('PASS without exit code zero or with timeout is rejected', () => {
  const base = {
    criterion_key: key, criterion_id: contract.id, contract_sha256: contractFingerprint(key, contract), provenance: 'local_cli',
    adapter: 'node_test', target: 'proof.test.mjs', verifier: 'vibus-cli-v6.2', verified: true, result: 'PASS',
  };
  assert.equal(receiptMatchesContract(key, contract, resign({ ...base, exit_code: 1, timed_out: false })), false);
  assert.equal(receiptMatchesContract(key, contract, resign({ ...base, exit_code: 0, timed_out: true })), false);
});

test('human_review requires human provenance and a user verifier', () => {
  const valid = resign({
    criterion_key: key, criterion_id: contract.id, contract_sha256: contractFingerprint(key, contract), provenance: 'human_review',
    adapter: 'human_review', target: 'browser-session', verifier: 'user:123', verified: true, result: 'PASS',
  });
  assert.equal(receiptMatchesContract(key, contract, valid), true);
  assert.equal(receiptMatchesContract(key, contract, resign({ ...valid, verifier: 'vibus-cli-v6.2' })), false);
});
