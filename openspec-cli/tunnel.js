/**
 * Vibus OpenSpec — Live Preview Tunnel Client
 * Поднимает защищенный туннель между локальным dev-сервером (localhost) и облачным шлюзом Vibus.
 */

import WebSocket from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { CloudMutationQueue } from './cloud-mutation-queue.js';
import { verifyCriterion, canAutoReview, criterionNeedsVerification, renderCriterionDetails, renderCriterionMachineBlock } from './criteria-verifier.js';


const AI_EXECUTION_CONTRACT_V2 = `> [!IMPORTANT]\n> **VibeUs Engineering Execution Contract v2**\n> Treat every DoD item as a mandatory engineering contract, not a self-certification checkbox. [x] is only an implementation CLAIM; verification evidence is stored separately.\n> Inspect the existing implementation and tests first; identify the root cause and broken invariant; preserve valid neighboring behavior.\n> Never mark [x] before the required verification actually ran and passed. Never fabricate verifier metadata, targets, exit codes, or evidence receipts. If you cannot run it, leave [ ] and report BLOCKED with the exact reason.\n> Bug fixes require a regression test that fails on the old behavior and passes after the fix. Add a positive control when a negative test could pass by disabling the feature.\n> Security-sensitive work must cover applicable unauthenticated, unauthorized/cross-tenant, forged/replayed input, boundary, and secret/PII leakage cases.\n> Mutable/money-sensitive work must analyze retries, duplicate requests/events, concurrency, partial failure, crash boundaries, and side-effect ordering.\n> External providers: never trust HTTP 2xx alone; validate required fields and cover timeout, malformed 2xx, 4xx/5xx, replay/retry, and out-of-order delivery when applicable.\n> Persistent critical invariants belong in the database when application-only validation can be bypassed. Never rewrite published migrations; use a forward migration and test blank->head plus previous-production->head when applicable.\n> Forbidden shortcuts: no skip/xfail, weakened assertions, test-only production branches, hard-coded expected outputs, catch-and-ignore, disabling the protected feature, or editing protected quality gates.\n> Final handoff must include, for each BLOCKER/HIGH criterion: CRITERION, IMPLEMENTATION, TEST_OR_VERIFICATION, exact COMMAND actually run, RESULT (PASS/BLOCKED), and EVIDENCE. Never invent command results.\n> Final acceptance remains human Review; AI completion only means the implementation is ready to be reviewed.\n\n`;

export async function startTunnel(options = {}) {
  const localPort = parseInt(options.port || 5173, 10);
  const target_port = localPort;
  const serverUrl = (options.server || process.env.VIBUS_SERVER || 'https://vibeus.pro').replace(/\/$/, '');
  const projectId = options.project || 'dev_local';
  const apiToken = options.token || process.env.VIBUS_TOKEN || '';
  // target_port, ttl (symbolic replaces ttl_seconds), role, single_use
  const ttl = options.ttl || '7d';
  const role = options.role || 'reviewer';
  const single_use = !!(options.single_use ?? options.singleUse);
  const singleUse = single_use;

  // Create server-issued tunnel session
  let tunnelId, connector_secret, publicPreviewUrl;
  try {
    const res = await fetch(`${serverUrl}/api/projects/${encodeURIComponent(projectId)}/tunnels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        target_port,
        ttl,
        role,
        single_use
      })
    });
    
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new Error(`Authentication failed or project not found. Please provide a valid --token or VIBUS_TOKEN.`);
      }
      throw new Error(`Server returned ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json();
    tunnelId = data.tunnel_id;
    connector_secret = data.connector_secret;
    publicPreviewUrl = data.preview_url;
  } catch (e) {
    p.cancel(`Failed to issue secure tunnel session: ${e.message}`);
    process.exit(1);
  }
  
  let wsUrl = serverUrl.replace(/^http/, 'ws') + `/ws/tunnel/${tunnelId}`;

  console.clear();
  p.intro(pc.bgCyan(pc.black(' ⚡ VIBEUS LIVE PREVIEW TUNNEL (LOCAL SHARE) ')));

  const s = p.spinner();
  s.start(`Подключение к локальному серверу на порту :${localPort} и облачному шлюзу...`);

  // Verify local port is running
  const isPortActive = await checkLocalPort(localPort);
  if (!isPortActive) {
    s.stop(pc.yellow(`⚠️ Предупреждение: на порту :${localPort} пока ничего не отвечает.`));
    p.note(
      `Убедитесь, что ваш локальный dev-сервер (например, Vite/Next.js/React) запущен: \n` +
      pc.cyan(`npm run dev`) + ` на порту ${localPort}`,
      'Совет'
    );
  } else {
    s.stop(pc.green(`✓ Локальный dev-сервер обнаружен на localhost:${localPort}`));
  }

  // Connect WebSocket to VibeUs Gateway
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    p.cancel(`Не удалось подключиться к шлюзу туннелей: ${err.message}`);
    process.exit(1);
  }

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'tunnel.authenticate',
      connector_secret: connector_secret
    }));
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'tunnel.ready') {
        // Terminal Dashboard
        renderTunnelDashboard({
          tunnelId,
          publicPreviewUrl,
          localPort,
          projectId,
          ttl,
          role,
          singleUse
        });

        // Start Real-Time Local Project File Sync (.vibus/TASKS_FOR_AI.md & board.json)
        startBackgroundBoardSync({ projectId, serverUrl, token: apiToken });
      } else if (msg.type === 'http_request') {
        await handleIncomingHttpRequest(msg, localPort, ws);
      }
    } catch (e) {
      console.error(pc.red('Ошибка обработки сообщения от туннеля:'), e);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(pc.yellow(`\n🔌 Туннель закрыт (${code}). ${reason || ''}`));
    process.exit(0);
  });

  ws.on('error', (err) => {
    console.error(pc.red(`\n❌ Ошибка соединения туннеля:`), err.message);
  });

  // Keep-alive ping every 15 seconds
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 15000);

  // Graceful shutdown on Ctrl+C / SIGINT
  let isExiting = false;
  const handleExit = () => {
    if (isExiting) process.exit(0);
    isExiting = true;
    clearInterval(pingInterval);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.close(1000, 'Developer stopped tunnel'); } catch(e) {}
    }
    console.log('\n' + pc.cyan('⚡ Туннель VibeUs остановлен. Доступ с localhost закрыт.\n'));
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
  process.on('SIGHUP', handleExit);

  // Catch raw Ctrl+C (\u0003) or 'q' keypresses on Windows
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (key) => {
        if (key === '\u0003' || key === '\x03' || key === 'q' || key === 'Q') {
          handleExit();
        }
      });
    } catch(e) {}
  }
}

function renderTunnelDashboard({ tunnelId, publicPreviewUrl, localPort, projectId, ttl, role, singleUse }) {
  const roleName = role === 'team' ? 'Команда' : role === 'reviewer' ? 'Заказчик / PO' : 'Тестировщик';
  
  console.log('\n' + pc.bold(pc.green('🚀 ТУННЕЛЬ УСПЕШНО АКТИВИРОВАН!')));
  console.log(pc.dim('─'.repeat(65)));
  console.log(pc.bold('🔗 Публичная ссылка для заказчика:'));
  console.log(pc.cyan(pc.underline(`   ${publicPreviewUrl}`)));
  console.log();
  console.log(pc.bold('💻 Локальный сервер: ') + pc.white(`http://localhost:${localPort}`));
  console.log(pc.bold('🛡️ Роль доступа:      ') + pc.yellow(roleName));
  console.log(pc.bold('⏱️ Срок жизни:        ') + pc.white(ttl === 'forever' ? 'Бессрочно' : ttl));
  console.log(pc.bold('🔒 Одноразовый доступ: ') + (singleUse ? pc.green('Да (только 1 устройство)') : pc.slate ? pc.slate('Нет') : 'Нет'));
  console.log(pc.bold('🆔 ID проекта:        ') + pc.dim(projectId));
  console.log(pc.dim('─'.repeat(65)));
  console.log(pc.dim('📊 Live-лог запросов заказчика:'));
}

let detectedLocalHost = 'localhost';

async function handleIncomingHttpRequest(reqMsg, localPort, ws) {
  const startTime = Date.now();
  const { request_id, method, path, headers, body, is_base64 } = reqMsg;

  // Prepare body payload
  let payloadBuffer = null;
  if (body) {
    if (is_base64) {
      payloadBuffer = Buffer.from(body, 'base64');
    } else {
      payloadBuffer = Buffer.from(body, 'utf-8');
    }
  }

  const localReqHeaders = { ...headers };
  localReqHeaders['host'] = `localhost:${localPort}`;
  if (payloadBuffer) {
    localReqHeaders['content-length'] = payloadBuffer.length;
  }

  function tryRequest(host) {
    return new Promise((resolve) => {
      const options = {
        hostname: host,
        port: localPort,
        path: path,
        method: method,
        headers: localReqHeaders,
        timeout: 10000
      };

      const localReq = http.request(options, (localRes) => {
        const chunks = [];

        localRes.on('data', (chunk) => {
          chunks.push(chunk);
        });

        localRes.on('end', () => {
          const duration = Date.now() - startTime;
          const totalBuffer = Buffer.concat(chunks);
          
          const contentType = (localRes.headers['content-type'] || '').toLowerCase();
          const isText = contentType.includes('text/') || 
                         contentType.includes('application/json') || 
                         contentType.includes('application/javascript') || 
                         contentType.includes('image/svg+xml');

          let resBodyStr = '';
          let isBase64 = false;

          if (isText) {
            resBodyStr = totalBuffer.toString('utf-8');
          } else {
            resBodyStr = totalBuffer.toString('base64');
            isBase64 = true;
          }

          // Log request
          logHttpRequest(method, path, localRes.statusCode, duration);

          // Send response back to cloud gateway
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'http_response',
              request_id: request_id,
              status_code: localRes.statusCode,
              headers: localRes.headers,
              body: resBodyStr,
              is_base64: isBase64
            }));
          }
          resolve({ success: true });
        });
      });

      localReq.on('error', (err) => {
        resolve({ success: false, error: err });
      });

      localReq.on('timeout', () => {
        localReq.destroy();
        const duration = Date.now() - startTime;
        console.log(` ${pc.red('TIMEOUT')} ${pc.bold(method)} ${path} ${pc.dim(`${duration}ms`)}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'http_response',
            request_id: request_id,
            status_code: 504,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            body: `Local Gateway Timeout on ${host}:${localPort}`,
            is_base64: false
          }));
        }
        resolve({ success: true });
      });

      if (payloadBuffer) {
        localReq.write(payloadBuffer);
      }
      localReq.end();
    });
  }

  // Try primary detected host first (e.g. localhost)
  let result = await tryRequest(detectedLocalHost);
  if (!result.success && (result.error.code === 'ECONNREFUSED' || result.error.code === 'EHOSTUNREACH')) {
    // Fallback to 127.0.0.1 or localhost
    const fallbackHost = detectedLocalHost === 'localhost' ? '127.0.0.1' : 'localhost';
    result = await tryRequest(fallbackHost);
    if (result.success) {
      detectedLocalHost = fallbackHost; // Switch permanently
    }
  }

  if (!result.success) {
    const duration = Date.now() - startTime;
    const err = result.error;
    console.log(` ${pc.red('ERR')} ${pc.bold(method)} ${path} ${pc.red(`(${err.code || err.message})`)} ${pc.dim(`${duration}ms`)}`);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'http_response',
        request_id: request_id,
        status_code: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: `Local Proxy Error: Cannot connect to localhost:${localPort} (${err.message})`,
        is_base64: false
      }));
    }
  }
}

function logHttpRequest(method, path, statusCode, duration) {
  const statusColor = statusCode >= 500 ? pc.red :
                      statusCode >= 400 ? pc.yellow :
                      statusCode >= 300 ? pc.cyan : pc.green;

  const timeStr = `${duration}ms`;
  console.log(` ${statusColor(statusCode)} ${pc.bold(method.padEnd(6))} ${path} ${pc.dim(timeStr)}`);
}

function checkPortHost(host, port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: host,
      port: port,
      path: '/',
      method: 'GET',
      timeout: 1000
    }, (res) => {
      resolve(true);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function checkLocalPort(port) {
  if (await checkPortHost('localhost', port)) {
    detectedLocalHost = 'localhost';
    return true;
  }
  if (await checkPortHost('127.0.0.1', port)) {
    detectedLocalHost = '127.0.0.1';
    return true;
  }
  return false;
}

function startBackgroundBoardSync({ projectId, serverUrl, token, apiToken }) {
  const outputDir = path.resolve(process.cwd(), '.vibus');
  const boardJsonPath = path.join(outputDir, 'board.json');
  const tasksMdPath = path.join(outputDir, 'TASKS_FOR_AI.md');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let syncWs;
  let lastContent = '';
  let currentBoard = { project_id: projectId, nodes: [] };
  const syncWsUrl = serverUrl.replace(/^http/, 'ws') + `/ws/sync/${encodeURIComponent(projectId)}`;

  function saveMarkdown(board) {
    try {
      let md = `# VibeUs — AI Engineering Tasks (${projectId})\n\n`;
      md += `> This file is synchronized in real time with VibeUs Live Preview. Follow the execution contract before editing any checklist.\n\n`;
      md += AI_EXECUTION_CONTRACT_V2;

      if (!board.nodes || board.nodes.length === 0) {
        md += '_Пока нет созданных задач._\n';
      } else {
        for (const node of board.nodes) {
          md += `## 📁 ${node.title}\n`;
          if (node.description) md += `_${node.description}_\n\n`;

          if (!node.tickets || node.tickets.length === 0) {
            md += '  _Нет задач в этом разделе_\n\n';
            continue;
          }

          for (const ticket of node.tickets) {
            const statusIcons = {
              'backlog': '⏳ [Бэклог]',
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

            if (ticket.bug_context) {
              if (ticket.bug_context.selector) {
                md += `> 🎯 **DOM-селектор:** \`${ticket.bug_context.selector}\` on ${ticket.bug_context.url || 'page'}\n\n`;
              }
              if (ticket.bug_context.apiEndpoint) {
                md += `> 🌐 **API Эндпоинт:** \`${ticket.bug_context.apiEndpoint}\` (${ticket.bug_context.httpStatus || ''})\n\n`;
              }
            }

            if (ticket.checklists && Object.keys(ticket.checklists).length > 0) {
              md += '**Критерии готовности (DoD):**\n';
              for (const [key, val] of Object.entries(ticket.checklists)) {
                md += `- [${val ? 'x' : ' '}] ${key}\n`;
                const criterionContract = ticket.criteria_contract?.[key];
                const criterionEvidence = ticket.criteria_evidence?.[key];
                md += renderCriterionDetails(criterionContract, criterionEvidence);
                md += `${renderCriterionMachineBlock(key, criterionContract, criterionEvidence)}\n`;
              }
              md += '\n';
            }

            if (ticket.rework_notes) {
              md += `> ⚠️ **Замечания:** ${ticket.rework_notes}\n\n`;
            }

            md += '---\n\n';
          }
        }
      }

      lastContent = md;
      fs.writeFileSync(tasksMdPath, md, 'utf8');
    } catch (e) {}
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  let currentRevision = 0;

  async function fetchAuthoritativeBoard() {
    const base = serverUrl.replace(/\/$/, '');
    const authToken = token || apiToken;

    const headers = {};

    if (authToken) {
      headers['X-API-Token'] = authToken;
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}/board`,
      { headers },
    );

    if (!response.ok) {
      throw new Error(
        `Board resync failed with HTTP ${response.status}`,
      );
    }

    const data = await response.json();

    if (typeof data.revision === 'number') {
      currentRevision = data.revision;
    }

    currentBoard = data;

    fs.writeFileSync(
      boardJsonPath,
      JSON.stringify(data, null, 2),
      'utf8',
    );

    saveMarkdown(data);
    ensureTasksWatcher();

    return currentRevision;
  }

  const mutationQueue = new CloudMutationQueue({
    send: (mutation) => {
      if (
        !syncWs ||
        syncWs.readyState !== WebSocket.OPEN
      ) {
        throw new Error('Background sync WebSocket is not open');
      }

      syncWs.send(JSON.stringify(mutation));
    },

    resync: fetchAuthoritativeBoard,

    onRevision: (revision) => {
      currentRevision = revision;
    },

    onError: (error, mutation) => {
      console.error(
        pc.red('[VibeUs background sync error]'),
        error?.code || 'unknown_error',
        mutation?.event_id || '',
        error?.message || '',
      );
    },
  });

  function enqueueMutation(mutation) {
    return mutationQueue.enqueue(mutation);
  }

  async function checkMarkdownUpdates() {
    if (!fs.existsSync(tasksMdPath)) return;
    try {
      const content = fs.readFileSync(tasksMdPath, 'utf8');
      if (content === lastContent) return;

      let hasChanges = false;
      const updated = JSON.parse(JSON.stringify(currentBoard));

      if (!updated.nodes) return;
      for (const node of updated.nodes) {
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
                      enqueueMutation({ type: 'ticket.criteria.evidence', entity_id: ticket.id, payload: { key, receipt } });
                    } else {
                      console.warn(pc.yellow(`[VERIFY BLOCKED] ${ticket.id} / ${key}: ${receipt.reason || receipt.stderr || receipt.result}`));
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
                console.log(` ${pc.magenta('⚡')} ${pc.bold('[AI ACTION]')} Claims and required evidence are verified for [${ticket.id}]. Moving to Review...`);
                ticket.status = 'review';
                hasChanges = true;
                enqueueMutation({ type: 'ticket.status.change', entity_id: ticket.id, payload: { status: 'review', automation: true } });
              } else {
                console.warn(pc.yellow(`[EVIDENCE REQUIRED] ${ticket.id}: all boxes are claimed, but required Strict/Critical evidence is incomplete.`));
              }
            }
          }
        }
      }

      if (hasChanges) {
        lastContent = content;
        currentBoard = updated;
        fs.writeFileSync(boardJsonPath, JSON.stringify(updated, null, 2), 'utf8');
      }
    } catch (e) {
      console.error(pc.red('Ошибка парсинга TASKS_FOR_AI.md:'), e.message);
    }
  }

  let watcherAttached = false;
  function ensureTasksWatcher() {
    if (watcherAttached || !fs.existsSync(tasksMdPath)) return;
    watcherAttached = true;
    try {
      fs.watch(tasksMdPath, () => {
        void checkMarkdownUpdates();
      });
      fs.watchFile(tasksMdPath, { interval: 50 }, () => {
        void checkMarkdownUpdates();
      });
    } catch (e) {}
  }

  function connectSync() {
    try {
      syncWs = new WebSocket(syncWsUrl);

      syncWs.on('open', () => {
        mutationQueue.setConnected(false);

        const authToken = token || apiToken;

        if (authToken) {
          syncWs.send(
            JSON.stringify({
              type: 'auth',
              token: authToken,
            }),
          );
        }
      });

      syncWs.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          if (
            msg.type === 'auth_ok' ||
            msg.type === 'tunnel.ready'
          ) {
            return;
          }

          if (msg.type === 'event.ack') {
            await mutationQueue.handleAck(msg);
            return;
          }

          if (msg.type === 'event.error') {
            await mutationQueue.handleError(msg);
            return;
          }

          if (msg.type === 'board.refresh') {
            try {
              await mutationQueue.handleBoardRefresh(msg);
            } catch (error) {
              console.error(
                pc.red('[VibeUs resync failed]'),
                error.message,
              );
            }

            return;
          }

          if (msg.type === 'board.snapshot') {
            const data = msg.data || msg;

            if (typeof msg.revision === 'number') {
              currentRevision = msg.revision;
            } else if (
              typeof data.revision === 'number'
            ) {
              currentRevision = data.revision;
            }

            mutationQueue.setRevision(currentRevision);

            currentBoard = data;

            fs.writeFileSync(
              boardJsonPath,
              JSON.stringify(data, null, 2),
              'utf8',
            );

            saveMarkdown(data);
            ensureTasksWatcher();

            const totalTickets = (
              data.nodes || []
            ).reduce(
              (acc, node) =>
                acc + (node.tickets?.length || 0),
              0,
            );

            console.log(
              ` ${pc.green('✓')} ${pc.bold('VibeUs Sync:')} Задачи синхронизированы в ${pc.cyan('.vibus/TASKS_FOR_AI.md')} (${totalTickets} тикетов)`,
            );

            mutationQueue.setConnected(true);

            return;
          }

          // Legacy compatibility.
          if (msg && (msg.nodes || msg.project_id)) {
            if (typeof msg.revision === 'number') {
              currentRevision = msg.revision;
              mutationQueue.setRevision(currentRevision);
            }

            currentBoard = msg;

            fs.writeFileSync(
              boardJsonPath,
              JSON.stringify(msg, null, 2),
              'utf8',
            );

            saveMarkdown(msg);
            ensureTasksWatcher();
            mutationQueue.setConnected(true);
          }
        } catch (error) {
          console.error(
            pc.red('[VibeUs WS message error]'),
            error.message,
          );
        }
      });

      syncWs.on('close', () => {
        mutationQueue.setConnected(false);
        setTimeout(connectSync, 3000);
      });

      syncWs.on('error', () => {});
    } catch (e) {}
  }

  ensureTasksWatcher();
  try {
    fs.watch(outputDir, (eventType, filename) => {
      if (filename === 'TASKS_FOR_AI.md') {
        ensureTasksWatcher();
      }
    });
  } catch (e) {}

  connectSync();
}
