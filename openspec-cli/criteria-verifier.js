import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

export const SAFE_VERIFICATION_ADAPTERS = new Set(['pytest', 'node_test', 'npm_script', 'file_exists']);
export const LOCAL_VERIFIER_ID = 'vibus-cli-v6.2';
const SAFE_TARGET = /^[A-Za-z0-9_./:@-]+$/;
const SAFE_NPM_SCRIPT = /^[A-Za-z0-9_.:-]+$/;

function tail(text, max = 4000) {
  const value = String(text || '');
  return value.length <= max ? value : value.slice(value.length - max);
}

function safeRelativeTarget(target) {
  const value = String(target || '').trim();
  if (!value || value.length > 500 || !SAFE_TARGET.test(value)) return null;
  if (path.isAbsolute(value) || value.includes('..')) return null;
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function sha256Object(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function contractBindingMaterial(key, contract) {
  const verification = contract?.verification && typeof contract.verification === 'object' ? contract.verification : {};
  return {
    criterion_key: String(key),
    criterion_id: String(contract?.id || key),
    severity: String(contract?.severity || 'normal').toLowerCase(),
    requirement: String(contract?.requirement || ''),
    pass_condition: String(verification.passCondition || verification.pass_condition || ''),
    adapter: String(verification.adapter || '').trim(),
    target: String(verification.target || '').trim(),
  };
}

export function contractFingerprint(key, contract) {
  return sha256Object(contractBindingMaterial(key, contract));
}

function receiptDigestValid(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  const digest = String(receipt.receipt_sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) return false;
  const { receipt_sha256: _ignored, ...unsigned } = receipt;
  return sha256Object(unsigned) === digest;
}

export function receiptMatchesContract(key, contract, receipt) {
  if (!contract || typeof contract !== 'object' || !receiptDigestValid(receipt)) return false;
  const expected = contractBindingMaterial(key, contract);
  if (String(receipt.criterion_key || '') !== expected.criterion_key) return false;
  if (String(receipt.criterion_id || '') !== expected.criterion_id) return false;
  if (String(receipt.contract_sha256 || '').toLowerCase() !== contractFingerprint(key, contract)) return false;
  if (receipt.verified !== true || receipt.result !== 'PASS') return false;

  const adapter = String(receipt.adapter || '');
  const provenance = String(receipt.provenance || '');
  if (adapter === 'human_review') {
    return provenance === 'human_review' && String(receipt.verifier || '').startsWith('user:');
  }
  if (!SAFE_VERIFICATION_ADAPTERS.has(adapter)) return false;
  if (adapter !== expected.adapter || String(receipt.target || '') !== expected.target) return false;
  if (provenance !== 'local_cli' || receipt.verifier !== LOCAL_VERIFIER_ID) return false;
  if (receipt.exit_code !== 0 || receipt.timed_out === true) return false;
  return true;
}

function captureRepoState(cwd) {
  try {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000 });
    const status = spawnSync('git', ['status', '--porcelain=v1', '-uno'], { cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000 });
    if (head.status !== 0 || status.status !== 0) return {};
    const repoHead = String(head.stdout || '').trim();
    const dirtyText = String(status.stdout || '');
    return {
      repo_head: repoHead,
      repo_dirty: dirtyText.trim().length > 0,
      repo_fingerprint: crypto.createHash('sha256').update(`${repoHead}\n${dirtyText}`).digest('hex'),
    };
  } catch (_) {
    return {};
  }
}

function run(program, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn(program, args, { cwd, shell: false, windowsHide: true, env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref?.();
    }, timeoutMs);
    child.stdout?.on('data', (buf) => { stdout += buf.toString(); });
    child.stderr?.on('data', (buf) => { stderr += buf.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: tail(stdout), stderr: tail(`${stderr}\n${error.message}`), timedOut });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout: tail(stdout), stderr: tail(stderr), timedOut });
    });
  });
}

function finalize(receipt) {
  const completed = { ...receipt, completed_at: new Date().toISOString() };
  return { ...completed, receipt_sha256: sha256Object(completed) };
}

export async function verifyCriterion(contract, { cwd = process.cwd(), criterionKey } = {}) {
  const key = String(criterionKey || contract?.id || contract?.title || 'UNKNOWN');
  const verification = contract?.verification || {};
  const adapter = String(verification.adapter || '').trim();
  const targetRaw = String(verification.target || '').trim();
  const base = {
    criterion_key: key,
    criterion_id: String(contract?.id || key),
    contract_sha256: contractFingerprint(key, contract || {}),
    provenance: 'local_cli',
    adapter,
    target: targetRaw,
    verifier: LOCAL_VERIFIER_ID,
    started_at: new Date().toISOString(),
    ...captureRepoState(cwd),
  };

  if (!SAFE_VERIFICATION_ADAPTERS.has(adapter)) {
    return { ...base, verified: false, result: 'BLOCKED', reason: 'No safe allowlisted verification adapter is configured.' };
  }

  if (adapter === 'file_exists') {
    const target = safeRelativeTarget(targetRaw);
    if (!target) return { ...base, verified: false, result: 'BLOCKED', reason: 'Unsafe or missing relative file target.' };
    const exists = fs.existsSync(path.resolve(cwd, target));
    return finalize({ ...base, target, verified: exists, result: exists ? 'PASS' : 'FAIL', exit_code: exists ? 0 : 1, timed_out: false, observed: exists ? 'Required artifact exists.' : 'Required artifact is missing.' });
  }

  if (adapter === 'npm_script') {
    const parts = targetRaw.split(':');
    let packageDir = '.';
    let script = targetRaw;
    if (parts.length > 1 && (parts[0].includes('/') || fs.existsSync(path.resolve(cwd, parts[0], 'package.json')))) {
      packageDir = parts.shift();
      script = parts.join(':');
    }
    if (!safeRelativeTarget(packageDir) || !SAFE_NPM_SCRIPT.test(script)) {
      return { ...base, verified: false, result: 'BLOCKED', reason: 'Unsafe npm script target.' };
    }
    const packageJson = path.resolve(cwd, packageDir, 'package.json');
    if (!fs.existsSync(packageJson)) return { ...base, verified: false, result: 'BLOCKED', reason: `package.json not found for ${packageDir}` };
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    if (!pkg?.scripts || typeof pkg.scripts[script] !== 'string') return { ...base, verified: false, result: 'BLOCKED', reason: `npm script ${script} is not declared.` };
    const observed = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script, '--silent'], path.dirname(packageJson));
    return finalize({ ...base, verified: observed.exitCode === 0 && !observed.timedOut, result: observed.exitCode === 0 && !observed.timedOut ? 'PASS' : 'FAIL', exit_code: observed.exitCode, stdout: observed.stdout, stderr: observed.stderr, timed_out: observed.timedOut });
  }

  const target = safeRelativeTarget(targetRaw);
  if (!target) return { ...base, verified: false, result: 'BLOCKED', reason: 'Unsafe or missing relative test target.' };
  const command = adapter === 'pytest'
    ? [process.env.PYTHON || process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3'), ['-m', 'pytest', '-q', target]]
    : [process.execPath, ['--test', target]];
  const observed = await run(command[0], command[1], cwd);
  return finalize({ ...base, target, verified: observed.exitCode === 0 && !observed.timedOut, result: observed.exitCode === 0 && !observed.timedOut ? 'PASS' : 'FAIL', exit_code: observed.exitCode, stdout: observed.stdout, stderr: observed.stderr, timed_out: observed.timedOut });
}

export function criterionNeedsVerification(contract, qualityMode = 'strict') {
  if (qualityMode === 'standard') return false;
  const severity = String(contract?.severity || 'normal').toLowerCase();
  return severity === 'blocker' || severity === 'high';
}

export function canAutoReview(ticket) {
  const checklists = ticket?.checklists || {};
  const keys = Object.keys(checklists);
  if (keys.length === 0 || keys.some((key) => checklists[key] !== true)) return false;
  const qualityMode = String(ticket?.quality_mode || 'strict').toLowerCase();
  if (qualityMode === 'standard') return true;
  const contracts = ticket?.criteria_contract || {};
  const evidence = ticket?.criteria_evidence || {};
  return keys.every((key) => {
    const contract = contracts[key];
    if (!criterionNeedsVerification(contract, qualityMode)) return true;
    return receiptMatchesContract(key, contract, evidence[key]);
  });
}

export function renderCriterionMachineBlock(key, contract, evidence) {
  const safe = { key, contract: contract || null, evidence: evidence || null };
  return `<!-- vibus-criterion:${Buffer.from(JSON.stringify(safe), 'utf8').toString('base64')} -->`;
}

export function renderCriterionDetails(contract, evidence) {
  if (!contract || typeof contract !== 'object') return '';
  const verification = contract.verification || {};
  const lines = [
    `  - Contract: [${String(contract.severity || 'normal').toUpperCase()}] ${contract.id || 'CUSTOM'}`,
    contract.requirement ? `  - Requirement: ${String(contract.requirement).replace(/\n/g, ' ')}` : '',
    verification.passCondition ? `  - Pass condition: ${String(verification.passCondition).replace(/\n/g, ' ')}` : '',
    verification.adapter ? `  - Verifier: ${verification.adapter}${verification.target ? ` -> ${verification.target}` : ''}` : '  - Verifier: manual / not auto-verifiable',
    evidence?.verified === true && evidence?.result === 'PASS' ? `  - Evidence: VERIFIED PASS (${evidence.adapter}${evidence.target ? ` -> ${evidence.target}` : ''})` : '  - Evidence: UNVERIFIED',
  ].filter(Boolean);
  return `\n${lines.join('\n')}\n`;
}
