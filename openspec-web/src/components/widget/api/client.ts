import { getOrCreateDeviceId } from '../deviceIdentity';

function getHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const fingerprint = getOrCreateDeviceId();
  if (fingerprint) {
    headers['X-Device-Fingerprint'] = fingerprint;
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-API-Token'] = token;
  }
  return headers;
}

function cleanBase(serverUrl: string): string {
  if (!serverUrl || serverUrl === 'mock') return '';
  return serverUrl.replace(/\/$/, '');
}

export async function createTicket(
  serverUrl: string,
  projectId: string,
  nodeId: string,
  ticketData: any,
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return ticketData;
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/tickets`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(ticketData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create ticket');
  }
  return res.json();
}

export async function updateTicket(
  serverUrl: string,
  projectId: string,
  ticketId: string,
  updates: any,
  token?: string,
  expectedRevision?: number
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return updates;
  const headers = getHeaders(token);
  if (expectedRevision !== undefined && expectedRevision !== null) {
    headers['If-Match'] = String(expectedRevision);
  }
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'PUT',
    headers: headers,
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update ticket');
  }
  return res.json();
}

export async function reviewTicket(
  serverUrl: string,
  projectId: string,
  ticketId: string,
  action: 'accept' | 'rework',
  reworkNotes: string = '',
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { id: ticketId, status: action === 'accept' ? 'done' : 'in_progress', rework_notes: reworkNotes };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/review`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ action, rework_notes: reworkNotes })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to review ticket');
  }
  return res.json();
}

export async function deleteTicket(
  serverUrl: string,
  projectId: string,
  ticketId: string,
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok' };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'DELETE',
    headers: getHeaders(token)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete ticket');
  }
  return res.json();
}

export async function moveTicket(
  serverUrl: string,
  projectId: string,
  ticketId: string,
  moveData: { node_id: string; order?: number },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok' };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticketId)}/move`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(moveData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to move ticket');
  }
  return res.json();
}

export async function batchTickets(
  serverUrl: string,
  projectId: string,
  batchData: { operation: string; [key: string]: any },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok' };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/tickets/batch`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(batchData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to execute batch tickets operation');
  }
  return res.json();
}

export async function createNode(
  serverUrl: string,
  projectId: string,
  nodeData: { title: string; description?: string; parent_id?: string | null; content_markdown?: string },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { id: `node_${Date.now()}`, ...nodeData, tickets: [] };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(nodeData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create node');
  }
  return res.json();
}

export async function updateNode(
  serverUrl: string,
  projectId: string,
  nodeId: string,
  updates: { title?: string; description?: string; parent_id?: string | null; content_markdown?: string },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return updates;
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'PATCH',
    headers: getHeaders(token),
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update node');
  }
  return res.json();
}

export async function deleteNode(
  serverUrl: string,
  projectId: string,
  nodeId: string,
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok' };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
    headers: getHeaders(token)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete node');
  }
  return res.json();
}

export async function updateProjectSettings(
  serverUrl: string,
  projectId: string,
  settings: any,
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok' };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: 'PATCH',
    headers: getHeaders(token),
    body: JSON.stringify(settings)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update project settings');
  }
  return res.json();
}

export async function deleteColumn(
  serverUrl: string,
  projectId: string,
  columnId: string,
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok' };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/columns/${encodeURIComponent(columnId)}`, {
    method: 'DELETE',
    headers: getHeaders(token)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to delete column');
  }
  return res.json();
}

export async function createDiscussion(
  serverUrl: string,
  projectId: string,
  nodeId: string,
  discussionData: { quote: string; text: string; author?: string },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { id: `disc_${Date.now()}`, ...discussionData, comments: [] };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/discussions`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(discussionData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create discussion');
  }
  return res.json();
}

export async function addDiscussionComment(
  serverUrl: string,
  projectId: string,
  nodeId: string,
  discussionId: string,
  commentData: { text: string; author?: string },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { id: `c_${Date.now()}`, ...commentData, date: new Date().toISOString() };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/discussions/${encodeURIComponent(discussionId)}/comments`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(commentData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to add discussion comment');
  }
  return res.json();
}

export async function updateDiscussion(
  serverUrl: string,
  projectId: string,
  nodeId: string,
  discussionId: string,
  updates: any,
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return updates;
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/discussions/${encodeURIComponent(discussionId)}`, {
    method: 'PATCH',
    headers: getHeaders(token),
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update discussion');
  }
  return res.json();
}

export async function convertDiscussionToTicket(
  serverUrl: string,
  projectId: string,
  nodeId: string,
  discussionId: string,
  ticketData: { title: string; priority?: string; summary?: string },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok', ticket: { id: `tkt_${Date.now()}`, ...ticketData } };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/discussions/${encodeURIComponent(discussionId)}/convert-to-ticket`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(ticketData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to convert discussion to ticket');
  }
  return res.json();
}

export async function convertFeedbackToTicket(
  serverUrl: string,
  projectId: string,
  feedbackId: string,
  ticketData: { node_id: string; title: string; priority?: string },
  token?: string
): Promise<any> {
  const base = cleanBase(serverUrl);
  if (!base) return { status: 'ok', ticket: { id: `tkt_${Date.now()}`, ...ticketData } };
  const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/feedback/${encodeURIComponent(feedbackId)}/convert-to-ticket`, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(ticketData)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to convert feedback to ticket');
  }
  return res.json();
}
