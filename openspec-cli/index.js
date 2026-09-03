#!/usr/bin/env node

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { startTunnel } from './tunnel.js';
import { startMcpServer } from './mcp.js';
import { CloudMutationQueue } from './cloud-mutation-queue.js';
import { verifyCriterion, canAutoReview, criterionNeedsVerification, renderCriterionDetails, renderCriterionMachineBlock } from './criteria-verifier.js';

// Parse command-line args
const args = process.argv.slice(2);
function getArg(key, defaultValue) {
  const index = args.indexOf(key);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
}

const command = args[0] || 'listen';

const outputDir = path.resolve(process.cwd(), '.vibus');
const boardJsonPath = path.join(outputDir, 'board.json');
const tasksMdPath = path.join(outputDir, 'TASKS_FOR_AI.md');
const rcPath = path.resolve(process.cwd(), '.vibusrc.json');


const AI_EXECUTION_CONTRACT_V2 = `> [!IMPORTANT]\n> **VibeUs Engineering Execution Contract v2**\n> Treat every DoD item as a mandatory engineering contract, not a self-certification checkbox. [x] is only an implementation CLAIM; verification evidence is stored separately.\n> Inspect the existing implementation and tests first; identify the root cause and broken invariant; preserve valid neighboring behavior.\n> Never mark [x] before the required verification actually ran and passed. Never fabricate verifier metadata, targets, exit codes, or evidence receipts. If you cannot run it, leave [ ] and report BLOCKED with the exact reason.\n> Bug fixes require a regression test that fails on the old behavior and passes after the fix. Add a positive control when a negative test could pass by disabling the feature.\n> Security-sensitive work must cover applicable unauthenticated, unauthorized/cross-tenant, forged/replayed input, boundary, and secret/PII leakage cases.\n> Mutable/money-sensitive work must analyze retries, duplicate requests/events, concurrency, partial failure, crash boundaries, and side-effect ordering.\n> External providers: never trust HTTP 2xx alone; validate required fields and cover timeout, malformed 2xx, 4xx/5xx, replay/retry, and out-of-order delivery when applicable.\n> Persistent critical invariants belong in the database when application-only validation can be bypassed. Never rewrite published migrations; use a forward migration and test blank->head plus previous-production->head when applicable.\n> Forbidden shortcuts: no skip/xfail, weakened assertions, test-only production branches, hard-coded expected outputs, catch-and-ignore, disabling the protected feature, or editing protected quality gates.\n> Final handoff must include, for each BLOCKER/HIGH criterion: CRITERION, IMPLEMENTATION, TEST_OR_VERIFICATION, exact COMMAND actually run, RESULT (PASS/BLOCKED), and EVIDENCE. Never invent command results.\n> Final acceptance remains human Review; AI completion only means the implementation is ready to be reviewed.\n\n`;

function detectProjectName(rc = {}) {
  const fromArg = getArg('--project', null);
  if (fromArg) return fromArg;

  if (rc.projectId && rc.projectId !== 'demo-showcase' && rc.projectId !== 'dev_local') {
    return rc.projectId;
  }

  const pkgPath = path.resolve(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) {
        return pkg.name.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      }
    } catch (e) {}
  }

  const currentDir = path.basename(process.cwd());
  if (currentDir && currentDir !== '.' && currentDir !== '/') {
    return currentDir.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  return 'my_project';
}

// Handle "mcp" command
if (command === 'mcp') {
  let rc = {};
  if (fs.existsSync(rcPath)) {
    try {
      rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    } catch(e) {}
  }

  const project = detectProjectName(rc);
  const server = getArg('--server', rc.serverUrl || process.env.VIBUS_SERVER || 'https://vibeus.pro');
  const token = getArg('--token', rc.apiToken || process.env.VIBUS_TOKEN || '');

  startMcpServer({ server, project, token });
}
// Handle "share" or "tunnel" command
else if (command === 'share' || command === 'tunnel') {
  let rc = {};
  if (fs.existsSync(rcPath)) {
    try {
      rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    } catch(e) {}
  }

  const project = detectProjectName(rc);
  const port = getArg('--port', rc.port || 5173);
  const server = getArg('--server', rc.serverUrl || process.env.VIBUS_SERVER || 'https://vibeus.pro');
  const token = getArg('--token', rc.apiToken || process.env.VIBUS_TOKEN || null);
  const ttl = getArg('--ttl', '7d');
  const role = getArg('--role', 'reviewer');
  const singleUse = args.includes('--single-use') || args.includes('-s');

  // Persist project config
  try {
    fs.writeFileSync(rcPath, JSON.stringify({ ...rc, projectId: project, serverUrl: server, port }, null, 2));
  } catch (e) {}

  startTunnel({ port, server, project, token, ttl, role, singleUse });
} else {
  start();
}

async function runCli() {
  const settings = await getSettings();
  startSync(settings);
}

async function getSettings() {
  let projectId = getArg('--project', null);
  let serverUrl = getArg('--server', null);
  let apiToken = getArg('--token', null);

  // Load from rc file if exists
  if (fs.existsSync(rcPath)) {
    try {
      const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
      if (!projectId) projectId = rc.projectId;
      if (!serverUrl) serverUrl = rc.serverUrl;
    } catch(e) {}
  }

  if (command !== 'listen') {
    console.log(pc.bold('Vibus CLI commands:'));
    console.log(`  ${pc.cyan('npx vibus listen')}            - Sync board with .vibus/TASKS_FOR_AI.md`);
    console.log(`  ${pc.cyan('npx vibus share [--port 5173]')} - Live Preview Tunnel for client/reviewers`);
    process.exit(0);
  }

  if (!projectId || !serverUrl) {
    p.intro(pc.bgBlue(pc.white(' VIBUS LOCAL AI BRIDGE ')));
    const group = await p.group({
      serverUrl: () => p.text({
        message: 'Server URL?',
        initialValue: serverUrl || 'https://vibeus.pro',
        validate: (val) => !val ? 'Required' : undefined
      }),
      projectId: () => p.text({
        message: 'Project ID?',
        initialValue: projectId || '',
        validate: (val) => !val ? 'Required' : undefined
      }),
      apiToken: () => p.text({
        message: 'API Token (optional)?',
        initialValue: apiToken || ''
      })
    }, { onCancel: () => { p.cancel('Cancelled.'); process.exit(0); } });

    projectId = group.projectId;
    serverUrl = group.serverUrl;
    apiToken = group.apiToken;

    fs.writeFileSync(rcPath, JSON.stringify({ projectId, serverUrl }, null, 2));
    p.note('Settings saved to .vibusrc.json', 'Config');
  } else {
    console.log('\n' + pc.bgBlue(pc.white(' VIBUS LOCAL AI BRIDGE ')) + '\n');
  }

  let wsServerUrl = serverUrl;
  if (wsServerUrl.startsWith('http://')) wsServerUrl = wsServerUrl.replace('http://', 'ws://');
  if (wsServerUrl.startsWith('https://')) wsServerUrl = wsServerUrl.replace('https://', 'wss://');

  return { projectId, serverUrl, wsServerUrl, apiToken };
}

let currentBoardData = { project_id: '', nodes: [] };
let currentRevision = 0;
let isWritingLocally = false;
let fileWatchDebounce = null;
let reconnectAttempts = 0;

function getChecklistLabel(key) {
  const labels = {
    'spec_updated': 'ТЗ описано',
    'backend_code': 'Бэкенд-код написан',
    'frontend_code': 'Фронтенд-код написан',
    'backend_tests': 'Автотесты написаны',
    'legal_approved': 'Юридическое одобрение'
  };
  return labels[key] || key;
}

function saveTasksMarkdown(data) {
  try {
    let md = '# VibeUs — Tasks for AI Engineering Agents\n\n';
    md += '> This file is synchronized by VibeUs CLI. Follow the execution contract below before editing any checklist.\n\n';
    md += AI_EXECUTION_CONTRACT_V2;

    if (!data.nodes || data.nodes.length === 0) {
      md += '_Пока нет активных задач в спецификации._\n';
    } else {
      for (const node of data.nodes) {
        md += `## 📁 ${node.title}\n`;
        if (node.description) {
          md += `_${node.description}_\n\n`;
        } else {
          md += '\n';
        }

        if (!node.tickets || node.tickets.length === 0) {
          md += '  _Нет задач в этом разделе_\n\n';
          continue;
        }

        for (const ticket of node.tickets) {
          const statusIcons = {
            'backlog': '📋 [Бэклог]',
            'in_progress': '⚡ [В работе]',
            'review': '🔍 [Приемка / QA]',
            'done': '✅ [Готово]'
          };
          const icon = statusIcons[ticket.status] || `[${ticket.status}]`;
          const priorityBadge = ticket.priority === 'high' ? '🔥 HIGH' : (ticket.priority === 'low' ? '🌱 LOW' : '⚡ MED');

          md += `### ${icon} ${ticket.title} \`(${priorityBadge})\` <!-- id: ${ticket.id} -->\n`;
          if (ticket.summary) {
            md += `> ${ticket.summary.replace(/\n/g, '\n> ')}\n\n`;
          }

          if (ticket.source_quote) {
            md += `> 💬 **Цитата из ТЗ:** _"${ticket.source_quote}"_\n\n`;
          }

          if (ticket.bug_context) {
            if (ticket.bug_context.selector) {
              md += `> 🎯 **DOM-элемент:** \`${ticket.bug_context.selector}\` на ${ticket.bug_context.url || 'странице'}\n\n`;
            }
            if (ticket.bug_context.os || ticket.bug_context.browser || ticket.bug_context.viewport) {
              md += `> 📱 **Клиент:** ${ticket.bug_context.browser || 'Браузер'} • ${ticket.bug_context.os || 'ОС'} (Экран: ${ticket.bug_context.viewport || 'Вьюпорт'})\n\n`;
            }
          }

          if (ticket.checklists && Object.keys(ticket.checklists).length > 0) {
            md += '**Критерии готовности (DoD):**\n';
            for (const [key, val] of Object.entries(ticket.checklists)) {
              const mark = val ? 'x' : ' ';
              const mappedLabel = getChecklistLabel(key);
              if (mappedLabel && mappedLabel !== key) {
                md += `- [${mark}] \`${key}\` (${mappedLabel})\n`;
              } else {
                md += `- [${mark}] ${key}\n`;
              }
              const criterionContract = ticket.criteria_contract?.[key];
              const criterionEvidence = ticket.criteria_evidence?.[key];
              md += renderCriterionDetails(criterionContract, criterionEvidence);
              md += `${renderCriterionMachineBlock(key, criterionContract, criterionEvidence)}\n`;
            }
            md += '\n';
          }

          if (ticket.rework_notes) {
            md += `> ⚠️ **Замечания по доработке:** ${ticket.rework_notes}\n\n`;
          }

          md += '---\n\n';
        }
      }
    }

    fs.writeFileSync(tasksMdPath, md, 'utf8');
  } catch (err) {
    console.error('\x1b[31m[ERROR]\x1b[0m Ошибка записи TASKS_FOR_AI.md:', err.message);
  }
}

function safeWriteJson(data) {
  isWritingLocally = true;
  currentBoardData = data;
  try {
    fs.writeFileSync(boardJsonPath, JSON.stringify(data, null, 2), 'utf8');
    saveTasksMarkdown(data);
    console.log(`\x1b[32m[SYNC]\x1b[0m 📝 Обновлены ${pc.cyan('.vibus/board.json')} и ${pc.yellow('.vibus/TASKS_FOR_AI.md')}`);
  } catch (err) {
    console.error('\x1b[31m[ERROR]\x1b[0m Ошибка записи файлов:', err.message);
  } finally {
    setTimeout(() => {
      isWritingLocally = false;
    }, 500);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let mutationQueue = null;

function getMutationQueue() {
  if (!mutationQueue) {
    mutationQueue = new CloudMutationQueue({
      send: (mutation) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error('WebSocket is not open');
        }

        ws.send(JSON.stringify(mutation));
      },

      resync: async () => {
        const revision = await fetchInitialState();

        if (typeof revision !== 'number') {
          throw new Error(
            'Failed to obtain authoritative board revision',
          );
        }

        return revision;
      },

      onRevision: (revision) => {
        currentRevision = revision;
      },

      onError: (error, mutation) => {
        console.error(
          '\x1b[31m[SYNC ERROR]\x1b[0m',
          error?.code || 'unknown_error',
          mutation?.event_id || '',
          error?.message || '',
        );
      },
    });
  }

  return mutationQueue;
}

function enqueueMutation(mutation) {
  return getMutationQueue().enqueue(mutation);
}

function getTicketSection(content, ticketId) {
  const marker = `<!-- id: ${ticketId} -->`;
  const idx = content.indexOf(marker);
  if (idx === -1) return '';
  const nextMarkerIdx = content.indexOf('<!-- id: ', idx + marker.length);
  if (nextMarkerIdx === -1) {
    return content.slice(idx);
  }
  return content.slice(idx, nextMarkerIdx);
}

async function checkMarkdownForAIUpdates() {
  if (isWritingLocally) return;
  if (!fs.existsSync(tasksMdPath)) return;

  try {
    const content = fs.readFileSync(tasksMdPath, 'utf8');
    let hasChanges = false;
    const updatedBoard = JSON.parse(JSON.stringify(currentBoardData));

    if (!updatedBoard.nodes) return;

    for (const node of updatedBoard.nodes) {
      if (!node.tickets) continue;
      for (const ticket of node.tickets) {
        const ticketSection = getTicketSection(content, ticket.id);
        if (!ticketSection) continue;

        if (ticket.checklists) {
          let allChecked = true;
          let checklistCount = 0;
          for (const key of Object.keys(ticket.checklists)) {
            checklistCount++;
            const reg = new RegExp(`-\\s*\\[([ xX])\\]\\s*(?:\`?)${escapeRegex(key)}(?:\`?)`);
            const match = ticketSection.match(reg);
            if (match) {
              const isChecked = match[1].toLowerCase() === 'x';
              if (ticket.checklists[key] !== isChecked) {
                ticket.checklists[key] = isChecked;
                hasChanges = true;
                enqueueMutation({
                  type: 'ticket.checklist.change',
                  entity_id: ticket.id,
                  payload: { key: key, is_done: isChecked }
                });
                if (!isChecked && ticket.criteria_evidence?.[key]) {
                  const evidence = { ...(ticket.criteria_evidence || {}) };
                  delete evidence[key];
                  ticket.criteria_evidence = evidence;
                }
              }
              if (isChecked) {
                const contract = ticket.criteria_contract?.[key];
                const qualityMode = ticket.quality_mode || 'strict';
                const currentReceipt = ticket.criteria_evidence?.[key];
                if (criterionNeedsVerification(contract, qualityMode) && !(currentReceipt?.verified === true && currentReceipt?.result === 'PASS')) {
                  const receipt = await verifyCriterion(contract, { cwd: process.cwd(), criterionKey: key });
                  if (receipt.verified) {
                    ticket.criteria_evidence = { ...(ticket.criteria_evidence || {}), [key]: receipt };
                    hasChanges = true;
                    enqueueMutation({
                      type: 'ticket.criteria.evidence',
                      entity_id: ticket.id,
                      payload: { key, receipt }
                    });
                  } else {
                    console.warn(`\x1b[33m[VERIFY BLOCKED]\x1b[0m ${ticket.id} / ${key}: ${receipt.reason || receipt.stderr || receipt.result}`);
                  }
                }
              } else {
                allChecked = false;
              }
            } else {
              allChecked = false;
            }
          }

          if (checklistCount > 0 && allChecked && ticket.status !== 'done' && ticket.status !== 'review') {
            if (canAutoReview(ticket)) {
              console.log(`\x1b[35m[AI ACTION]\x1b[0m 🎯 Claims and required evidence are verified for [${ticket.id}]. Moving to Review...`);
              ticket.status = 'review';
              hasChanges = true;
              enqueueMutation({
                type: 'ticket.status.change',
                entity_id: ticket.id,
                payload: { status: 'review', automation: true }
              });
            } else {
              console.warn(`\x1b[33m[EVIDENCE REQUIRED]\x1b[0m ${ticket.id}: all boxes are claimed, but Strict/Critical BLOCKER/HIGH evidence is incomplete. Review is blocked.`);
            }
          }
        }
      }
    }

    if (hasChanges) {
      currentBoardData = updatedBoard;
      fs.writeFileSync(boardJsonPath, JSON.stringify(updatedBoard, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('\x1b[31m[ERROR]\x1b[0m Ошибка парсинга TASKS_FOR_AI.md:', err.message);
  }
}

function startWatcher() {
  if (fs.existsSync(tasksMdPath)) {
    fs.watch(tasksMdPath, (eventType) => {
      if (eventType === 'change') {
        if (fileWatchDebounce) clearTimeout(fileWatchDebounce);
        fileWatchDebounce = setTimeout(() => {
          void checkMarkdownForAIUpdates();
        }, 300);
      }
    });
  }

  if (fs.existsSync(boardJsonPath)) {
    fs.watch(boardJsonPath, (eventType) => {
      if (eventType === 'change' && !isWritingLocally) {
        try {
          const content = fs.readFileSync(boardJsonPath, 'utf8');
          const parsed = JSON.parse(content);
          currentBoardData = parsed;
        } catch (e) {}
      }
    });
  }
}

async function fetchInitialState() {
  const restUrl =
    serverUrl.replace(/\/$/, '') +
    `/api/projects/${projectId}/board`;

  console.log(
    `⏳ Запрос авторитетного состояния: ${restUrl}`,
  );

  try {
    const headers = {};

    if (apiToken) {
      headers['X-API-Token'] = apiToken;
      headers['Authorization'] = `Bearer ${apiToken}`;
    }

    const res = await fetch(restUrl, { headers });

    if (!res.ok) {
      console.log(
        `\x1b[33m[REST]\x1b[0m ⚠️ Не удалось получить состояние (status: ${res.status})`,
      );
      return null;
    }

    const data = await res.json();

    if (
      data &&
      typeof data.revision === 'number'
    ) {
      currentRevision = data.revision;
    }

    console.log(
      '\x1b[34m[REST]\x1b[0m 📥 Получено авторитетное состояние',
    );

    safeWriteJson(data);

    return currentRevision;
  } catch (err) {
    console.log(
      `\x1b[33m[REST]\x1b[0m ⚠️ Сервер пока недоступен: ${err.message}`,
    );

    return null;
  }
}

let ws;
let wsUrl;
let projectId;
let serverUrl;
let apiToken;

function connect() {
  console.log('⏳ Подключение к Vibus WebSocket...');
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    reconnectAttempts = 0;

    // Queue starts only after authoritative board.snapshot.
    getMutationQueue().setConnected(false);

    if (apiToken) {
      ws.send(
        JSON.stringify({
          type: 'auth',
          token: apiToken,
        }),
      );
    }

    console.log(
      '\x1b[32m[CONNECTED]\x1b[0m 🟢 WebSocket подключен, ожидаем board.snapshot...\n',
    );
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const queue = getMutationQueue();

      if (msg.type === 'auth_ok') {
        return;
      }

      if (msg.type === 'event.ack') {
        await queue.handleAck(msg);
        return;
      }

      if (msg.type === 'event.error') {
        await queue.handleError(msg);
        return;
      }

      if (msg.type === 'board.refresh') {
        try {
          await queue.handleBoardRefresh(msg);
        } catch (error) {
          console.error(
            '\x1b[31m[RESYNC ERROR]\x1b[0m',
            error.message,
          );
        }

        return;
      }

      if (msg.type === 'board.snapshot') {
        const board = msg.data || msg;

        if (typeof msg.revision === 'number') {
          currentRevision = msg.revision;
        } else if (
          typeof board.revision === 'number'
        ) {
          currentRevision = board.revision;
        }

        queue.setRevision(currentRevision);

        console.log(
          '\x1b[34m[EVENT]\x1b[0m 📥 Получен board.snapshot',
        );

        safeWriteJson(board);

        // Only now queued mutations may be sent/retried.
        queue.setConnected(true);

        return;
      }

      // Legacy compatibility only.
      if (msg && msg.nodes) {
        if (typeof msg.revision === 'number') {
          currentRevision = msg.revision;
          queue.setRevision(currentRevision);
        }

        safeWriteJson(msg);
        queue.setConnected(true);

        return;
      }
    } catch (error) {
      console.error(
        '\x1b[31m[WS MESSAGE ERROR]\x1b[0m',
        error.message,
      );
    }
  });

  ws.on('close', () => {
    getMutationQueue().setConnected(false);

    reconnectAttempts++;

    const delay = Math.min(
      1000 * Math.pow(1.5, reconnectAttempts) +
        Math.random() * 500,
      30000,
    );

    console.log(
      `\x1b[31m[DISCONNECTED]\x1b[0m 🔴 Соединение закрыто. Повтор через ${(delay / 1000).toFixed(1)} сек...`,
    );

    setTimeout(connect, delay);
  });

  ws.on('error', (err) => {
    console.error(`\x1b[31m[WS ERROR]\x1b[0m ${err.message}`);
  });
}

function shutdown() {
  console.log('\n\x1b[33m[SHUTDOWN]\x1b[0m Завершение работы...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
}

async function start() {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const settings = await getSettings();
  projectId = settings.projectId;
  serverUrl = settings.serverUrl;
  apiToken = settings.apiToken;
  currentBoardData.project_id = projectId;
  
  wsUrl = settings.wsServerUrl.replace(/\/$/, '') + '/ws/sync/' + projectId;
  
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  console.log(`📌 Project ID : ${pc.cyan(projectId)}`);
  console.log(`🌐 Server     : ${pc.magenta(wsUrl)}`);
  console.log(`📂 Output Dir : ${pc.yellow(outputDir)}\n`);

  await fetchInitialState();
  connect();
  startWatcher();
}
