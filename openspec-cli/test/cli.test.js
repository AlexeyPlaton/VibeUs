import test from 'node:test';
import assert from 'node:assert/strict';
import { startTunnel } from '../tunnel.js';
import { startMcpServer } from '../mcp.js';

test('Vibus CLI modules export required functions', (t) => {
  assert.equal(typeof startTunnel, 'function', 'startTunnel should be a function');
  assert.equal(typeof startMcpServer, 'function', 'startMcpServer should be a function');
});

test('startTunnel is callable', async (t) => {
  assert.ok(startTunnel);
});
