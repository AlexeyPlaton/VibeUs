#!/usr/bin/env python3
"""
Vibus Model Context Protocol (MCP) Server
Allows AI Agents (Cursor, Claude Desktop, Claude Code, Antigravity, Windsurf)
to query, inspect, update and resolve tickets collected by Vibus.

Protocol: JSON-RPC 2.0 over standard I/O (stdio)
"""

import sys
import json
import os
import argparse
import urllib.request
import urllib.error

DEFAULT_SERVER_URL = os.environ.get("VIBUS_SERVER_URL", "http://localhost:8000")
DEFAULT_PROJECT_SLUG = os.environ.get("VIBUS_PROJECT", "demo-showcase")
DEFAULT_API_TOKEN = os.environ.get("VIBUS_TOKEN", "")

def make_api_request(endpoint, method="GET", payload=None, server_url=DEFAULT_SERVER_URL, token=DEFAULT_API_TOKEN):
    url = f"{server_url.rstrip('/')}/{endpoint.lstrip('/')}"
    headers = {"Content-Type": "application/json", "User-Agent": "Vibus-MCP-Server/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-API-Token"] = token
        
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            res_body = response.read().decode("utf-8")
            return json.loads(res_body) if res_body else {}
    except urllib.error.HTTPError as e:
        err_text = e.read().decode("utf-8")
        try:
            return {"error": True, "status": e.code, "detail": json.loads(err_text)}
        except Exception:
            return {"error": True, "status": e.code, "detail": err_text}
    except Exception as e:
        return {"error": True, "status": 500, "detail": str(e)}

TOOLS = [
    {
        "name": "vibus_list_tickets",
        "description": "List bugs, tasks and feature requests collected by the Vibus widget for this project.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_slug": {
                    "type": "string",
                    "description": "The project slug or ID (default from environment)",
                    "default": DEFAULT_PROJECT_SLUG
                },
                "status": {
                    "type": "string",
                    "enum": ["all", "backlog", "in_progress", "review", "done"],
                    "description": "Filter tickets by status",
                    "default": "all"
                }
            }
        }
    },
    {
        "name": "vibus_get_ticket_details",
        "description": "Get complete details of a specific bug/task, including DOM selector, screenshot, user agent, and checklist items.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "ticket_id": {
                    "type": "string",
                    "description": "The unique ID or key of the ticket (e.g. 'VB-1')"
                }
            },
            "required": ["ticket_id"]
        }
    },
    {
        "name": "vibus_update_ticket_status",
        "description": "Update the status of a Vibus ticket (e.g. mark as 'in_progress' when starting work, or 'review' / 'done' when resolved).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "ticket_id": {
                    "type": "string",
                    "description": "The ID of the ticket to update"
                },
                "status": {
                    "type": "string",
                    "enum": ["backlog", "in_progress", "review", "done"],
                    "description": "New status for the ticket"
                },
                "rework_notes": {
                    "type": "string",
                    "description": "Resolution notes, summary of changes made, or verification steps for reviewers"
                },
                "project_slug": {
                    "type": "string",
                    "description": "The project slug (optional)",
                    "default": DEFAULT_PROJECT_SLUG
                }
            },
            "required": ["ticket_id", "status"]
        }
    },
    {
        "name": "vibus_create_ticket",
        "description": "Create a new bug report or task directly on the Vibus Kanban board.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short title describing the task or bug"
                },
                "summary": {
                    "type": "string",
                    "description": "Detailed description, reproduction steps or acceptance criteria"
                },
                "priority": {
                    "type": "string",
                    "enum": ["critical", "high", "medium", "low"],
                    "default": "medium"
                },
                "project_slug": {
                    "type": "string",
                    "description": "The project slug",
                    "default": DEFAULT_PROJECT_SLUG
                }
            },
            "required": ["title"]
        }
    },
    {
        "name": "vibus_sync_github",
        "description": "Trigger synchronization of all pending Vibus tickets into GitHub Issues in the connected repository.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project_slug": {
                    "type": "string",
                    "description": "The project slug",
                    "default": DEFAULT_PROJECT_SLUG
                }
            }
        }
    }
]

def handle_tool_call(name, args, server_url, token):
    project_slug = args.get("project_slug") or DEFAULT_PROJECT_SLUG
    
    payload = {
        "name": name,
        "arguments": {**args, "project_slug": project_slug}
    }
    
    res = make_api_request("api/mcp/execute", method="POST", payload=payload, server_url=server_url, token=token)
    if isinstance(res, dict) and res.get("error"):
        return {
            "isError": True,
            "content": [{"type": "text", "text": f"Vibus API error: {res.get('detail')}"}]
        }
    return res

def process_message(msg, server_url, token):
    msg_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params", {})
    
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "vibus-mcp-server",
                    "version": "1.0.0"
                }
            }
        }
    elif method == "notifications/initialized":
        return None
    elif method == "ping":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {}
        }
    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "tools": TOOLS
            }
        }
    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        result = handle_tool_call(tool_name, arguments, server_url, token)
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": result
        }
    else:
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {
                "code": -32601,
                "message": f"Method '{method}' not found"
            }
        }

def run_stdio_server(server_url=DEFAULT_SERVER_URL, token=DEFAULT_API_TOKEN, project=DEFAULT_PROJECT_SLUG):
    global DEFAULT_SERVER_URL, DEFAULT_API_TOKEN, DEFAULT_PROJECT_SLUG
    DEFAULT_SERVER_URL = server_url
    DEFAULT_API_TOKEN = token
    DEFAULT_PROJECT_SLUG = project
    
    sys.stderr.write(f"[Vibus MCP] Server running (Target: {server_url}, Project: {project})\n")
    sys.stderr.flush()
    
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            resp = process_message(msg, server_url, token)
            if resp is not None:
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError:
            pass
        except Exception as e:
            sys.stderr.write(f"[Vibus MCP Error] {e}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vibus Model Context Protocol (MCP) Server")
    parser.add_argument("--server", default=DEFAULT_SERVER_URL, help="Vibus server URL (e.g. https://vibeus.pro or http://localhost:8000)")
    parser.add_argument("--token", default=DEFAULT_API_TOKEN, help="Vibus API token")
    parser.add_argument("--project", default=DEFAULT_PROJECT_SLUG, help="Default Project Slug/ID")
    
    args = parser.parse_args()
    run_stdio_server(server_url=args.server, token=args.token, project=args.project)
