import readline from 'readline';

const DEFAULT_TOOLS = [
  {
    name: 'vibus_list_tickets',
    description: 'List bugs, tasks and feature requests collected by the Vibus widget for an AI agent.',
    inputSchema: {
      type: 'object',
      properties: {
        project_slug: {
          type: 'string',
          description: 'The project slug or ID (default from environment or config)'
        },
        status: {
          type: 'string',
          enum: ['all', 'backlog', 'in_progress', 'review', 'done'],
          description: 'Filter by ticket status',
          default: 'all'
        }
      }
    }
  },
  {
    name: 'vibus_get_ticket_details',
    description: 'Get detailed information about a specific bug/ticket, including DOM selector, screenshot URL, user agent, and checklists.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The unique ID or key of the ticket (e.g. "VB-1")'
        }
      },
      required: ['ticket_id']
    }
  },
  {
    name: 'vibus_update_ticket_status',
    description: 'Update the status of a Vibus ticket (e.g. mark as "in_progress" while coding, or "review" / "done" after fixing).',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: {
          type: 'string',
          description: 'The ID of the ticket'
        },
        status: {
          type: 'string',
          enum: ['backlog', 'in_progress', 'review', 'done'],
          description: 'New status for the ticket'
        },
        rework_notes: {
          type: 'string',
          description: 'Resolution notes or explanation of fix for reviewers'
        },
        project_slug: {
          type: 'string',
          description: 'The project slug'
        }
      },
      required: ['ticket_id', 'status']
    }
  },
  {
    name: 'vibus_create_ticket',
    description: 'Create a new bug report or task on the Vibus Kanban board directly from AI assistant.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title describing the task or bug'
        },
        summary: {
          type: 'string',
          description: 'Detailed description, steps to reproduce or acceptance criteria'
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          default: 'medium'
        },
        project_slug: {
          type: 'string',
          description: 'The project slug'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'vibus_sync_github',
    description: 'Sync all pending Vibus tickets to GitHub Issues in the connected GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        project_slug: {
          type: 'string',
          description: 'The project slug'
        }
      }
    }
  }
];

export function startMcpServer({ server = 'http://localhost:8000', project = 'demo-showcase', token = '' } = {}) {
  process.stderr.write(`[Vibus MCP] Server running on stdio (Target: ${server}, Project: ${project})\n`);

  async function makeApiCall(endpoint, method = 'GET', body = null) {
    const url = `${server.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Vibus-MCP-CLI/1.0'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-API-Token'] = token;
    }

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
      return await resp.json();
    } catch (e) {
      return { error: true, message: e.message };
    }
  }

  async function handleToolCall(name, args) {
    const projectSlug = args.project_slug || project;
    const payload = {
      name,
      arguments: { ...args, project_slug: projectSlug }
    };

    const res = await makeApiCall('api/mcp/execute', 'POST', payload);
    if (res && res.error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Vibus API error: ${res.message || JSON.stringify(res)}` }]
      };
    }
    return res;
  }

  async function processMessage(msg) {
    const { id, method, params } = msg;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'vibus-mcp-server',
            version: '1.0.0'
          }
        }
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: DEFAULT_TOOLS
        }
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const result = await handleToolCall(toolName, args);
      return {
        jsonrpc: '2.0',
        id,
        result
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method '${method}' not found`
      }
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      const resp = await processMessage(msg);
      if (resp !== null) {
        process.stdout.write(JSON.stringify(resp) + '\n');
      }
    } catch (e) {
      process.stderr.write(`[Vibus MCP Parse Error] ${e.message}\n`);
    }
  });
}
