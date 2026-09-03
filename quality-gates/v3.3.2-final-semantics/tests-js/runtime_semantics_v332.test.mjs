import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = process.env.VIBUS_PROJECT_ROOT;
if (!root) throw new Error('VIBUS_PROJECT_ROOT is required');
const projectRequire = createRequire(path.join(root, 'openspec-web', 'package.json'));
const ts = projectRequire('typescript');

async function loadTsModule(srcPath, name) {
  const source = fs.readFileSync(srcPath, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const tmp = path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, js);
  return import(pathToFileURL(tmp).href + `?v=${Date.now()}`);
}

const queuePath = path.join(root, 'openspec-web', 'src', 'components', 'widget', 'mutations', 'mutationQueue.ts');
const { WsMutationQueue } = await loadTsModule(queuePath, 'vibus-v332-queue');

test('duplicate ACK without revision must not poison current revision', async () => {
  let rev = 42;
  const sent = [];
  const q = new WsMutationQueue({
    send: m => sent.push(structuredClone(m)),
    getRevision: () => rev,
    setRevision: r => { rev = r; },
    resync: async () => rev,
    onError: () => {}
  });
  q.setConnected(true);
  const a = q.enqueue({ type: 'ticket.status.change', entity_id: 'A', payload: { status: 'review' } });
  q.enqueue({ type: 'ticket.status.change', entity_id: 'B', payload: { status: 'done' } });
  await q.handleAck({ type: 'event.ack', event_id: a, duplicate: true });
  assert.equal(rev, 42, 'missing revision on duplicate ACK must not set revision to undefined');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].expected_revision, 42);
});

test('duplicate ACK with authoritative revision advances queue with that revision', async () => {
  let rev = 7;
  const sent = [];
  const q = new WsMutationQueue({
    send: m => sent.push(structuredClone(m)),
    getRevision: () => rev,
    setRevision: r => { rev = r; },
    resync: async () => rev,
    onError: () => {}
  });
  q.setConnected(true);
  const a = q.enqueue({ type: 'ticket.status.change', entity_id: 'A', payload: { status: 'review' } });
  q.enqueue({ type: 'ticket.status.change', entity_id: 'B', payload: { status: 'done' } });
  await q.handleAck({ type: 'event.ack', event_id: a, duplicate: true, revision: 9 });
  assert.equal(rev, 9);
  assert.equal(sent[1].expected_revision, 9);
});

test('typed REST client sends a stable X-Device-Fingerprint with authenticated mutations', async () => {
  // This is intentionally a runtime test. It does not accept a grep-only header string.
  const clientPath = path.join(root, 'openspec-web', 'src', 'components', 'widget', 'api', 'client.ts');
  const src = fs.readFileSync(clientPath, 'utf8');
  // For portable runtime loading, require client.ts to remain self-contained or expose a fingerprint getter in the same module.
  // If the production implementation imports deviceIdentity.ts, the static pytest test still enforces the contract and build:all
  // verifies module resolution. This runtime test rewrites only the import for deviceIdentity to a tiny equivalent temp module.
  let patched = src;
  if (/from\s+['\"].*deviceIdentity['\"]/.test(src)) {
    const helper = path.join(os.tmpdir(), `vibus-deviceIdentity-${process.pid}-${Date.now()}.mjs`);
    fs.writeFileSync(helper, `export function getOrCreateDeviceId(){ let x=globalThis.localStorage?.getItem('vibus_device_id'); if(!x){x='runtime-device-123'; globalThis.localStorage?.setItem('vibus_device_id',x);} return x; }`);
    patched = src.replace(/from\s+['\"][^'\"]*deviceIdentity['\"]/g, `from ${JSON.stringify(pathToFileURL(helper).href)}`);
  }
  const js = ts.transpileModule(patched, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const tmp = path.join(os.tmpdir(), `vibus-client-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, js);
  const client = await import(pathToFileURL(tmp).href + `?v=${Date.now()}`);

  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,String(v)) };
  globalThis.window = globalThis;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ id: 'T-1', revision: 2 }) };
  };

  await client.updateTicket('https://example.test', 'proj', 'T-1', { title: 'a' }, 'access-token', 1);
  await client.updateTicket('https://example.test', 'proj', 'T-1', { title: 'b' }, 'access-token', 2);
  assert.equal(calls.length, 2);
  const fp1 = calls[0].options.headers['X-Device-Fingerprint'];
  const fp2 = calls[1].options.headers['X-Device-Fingerprint'];
  assert.ok(fp1, 'authenticated typed REST request missing X-Device-Fingerprint');
  assert.equal(fp1, fp2, 'fingerprint must be stable across requests in the same browser/device');
});
