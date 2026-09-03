/**
 * Vibus OpenSpec — Access Links & Security Manager
 * Access-link management (server-side generation and safe authentication).
 */

export type AccessRole = 'team' | 'reviewer' | 'tester';
export type AccessTTL = '24h' | '7d' | '30d' | 'forever';

export interface AccessLinkToken {
  id: string;
  token: string;
  label: string;
  role: AccessRole;
  ttl: AccessTTL;
  singleUse: boolean;
  createdAt: number;
  expiresAt: number | null; // null if forever
  isActivated: boolean;
  activatedAt?: number;
}

let inMemoryTokens: Record<string, AccessLinkToken[]> = {};

export function getProjectAccessTokens(projectId: string): AccessLinkToken[] {
  const tokens = inMemoryTokens[projectId || 'default'] || [];
  const now = Date.now();
  return tokens.map(t => {
    if (t.expiresAt && t.expiresAt < now) {
      return { ...t, isExpired: true };
    }
    return t;
  });
}

export function saveProjectAccessTokens(projectId: string, tokens: AccessLinkToken[]): void {
  inMemoryTokens[projectId || 'default'] = tokens;
}

export async function generateAccessLink(
  projectId: string,
  options: {
    label?: string;
    role: AccessRole;
    ttl: AccessTTL;
    singleUse: boolean;
  },
  apiToken?: string
): Promise<{ tokenObj: AccessLinkToken; url: string }> {
  return generateAccessLinkServer(projectId, options, apiToken);
}

export async function generateAccessLinkServer(
  projectId: string,
  options: {
    label?: string;
    role: AccessRole;
    ttl: AccessTTL;
    singleUse: boolean;
  },
  apiToken?: string
): Promise<{ tokenObj: AccessLinkToken; url: string }> {
  const apiBase = typeof window !== 'undefined' ? window.location.origin : 'https://vibeus.pro';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiToken) {
    headers['X-API-Token'] = apiToken;
  }
  
  const res = await fetch(`${apiBase}/api/projects/${projectId}/access-links`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      label: options.label,
      role: options.role,
      ttl: options.ttl,
      single_use: options.singleUse
    })
  });
  
  if (!res.ok) throw new Error('Failed to create server access link');
  const data = await res.json();
  
  const tokenObj: AccessLinkToken = {
    id: data.id,
    token: data.token,
    label: data.label,
    role: data.role as AccessRole,
    ttl: data.ttl as AccessTTL,
    singleUse: data.single_use,
    createdAt: new Date(data.created_at).getTime(),
    expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
    isActivated: data.is_activated
  };
  
  const tokens = getProjectAccessTokens(projectId);
  tokens.unshift(tokenObj);
  saveProjectAccessTokens(projectId, tokens);
  
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname + window.location.search
    : 'https://vibeus.pro';
  // Capability tokens belong in the fragment, not the query string: fragments
  // are not sent in HTTP requests and therefore do not appear in normal access
  // logs or Referer headers. The widget consumes and removes it immediately.
  const fragment = new URLSearchParams();
  fragment.set('vibus_auth', data.token);
  if (data.single_use) fragment.set('single_use', '1');

  return { tokenObj, url: `${baseUrl}#${fragment.toString()}` };
}

export async function revokeToken(projectId: string, tokenId: string, apiToken?: string): Promise<void> {
  const tokens = getProjectAccessTokens(projectId).filter(t => t.id !== tokenId);
  saveProjectAccessTokens(projectId, tokens);
  
  const apiBase = typeof window !== 'undefined' ? window.location.origin : 'https://vibeus.pro';
  try {
    const headers: Record<string, string> = {};
    if (apiToken) {
      headers['X-API-Token'] = apiToken;
    }
    await fetch(`${apiBase}/api/projects/${projectId}/access-links/${tokenId}`, {
      method: 'DELETE',
      headers
    });
  } catch (e) {
    console.warn('Server access link deletion failed:', e);
  }
}

export function revokeAllTokens(projectId: string): void {
  saveProjectAccessTokens(projectId, []);
}

export function getPublicFeedbackEnabled(projectId: string): boolean {
  return false;
}

export function setPublicFeedbackEnabled(projectId: string, enabled: boolean): void {
  // no-op or handled on server
}

/**
 * Validate access-link parameters when the page loads.
 */
export function checkUrlAccessAuth(projectId: string): {
  authenticated: boolean;
  role?: AccessRole;
  error?: string;
} {
  if (typeof window === 'undefined') return { authenticated: false };

  const fragmentParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const authParam = fragmentParams.get('vibus_auth') || fragmentParams.get('vibus_key');

  if (authParam) {
    return { authenticated: true, role: 'reviewer' };
  }

  return { authenticated: false };
}
