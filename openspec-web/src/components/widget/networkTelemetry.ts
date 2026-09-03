import { tr } from '../../i18n/config';
/**
 * VibeUs Network & Console Telemetry Ring Buffer (Privacy-Preserving)
 * Intercepts request metadata (method, URL, status code, duration) without sensitive bodies or response payloads.
 */

export function safeUrl(raw: string): string {
  if (!raw) return '';
  try {
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';
    const parsed = new URL(raw, origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.split('?')[0]?.split('#')[0] || '';
  }
}

function createCorrelationId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `vbreq_${crypto.randomUUID().replace(/-/g, '')}`;
    }
  } catch {}
  return `vbreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function isSameOriginRequest(raw: string): boolean {
  try {
    return new URL(raw, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export interface NetworkLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  isError: boolean;
  isRoutineAuthCheck?: boolean | undefined;
  initiatorSelector?: string | undefined;
  requestId?: string | undefined;
}


export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  type: 'error' | 'warn';
  message: string;
  stack?: string;
}

const MAX_NETWORK_LOGS = 25;
const MAX_CONSOLE_LOGS = 15;

class TelemetryCollector {
  private networkLogs: NetworkLogEntry[] = [];
  private consoleLogs: ConsoleLogEntry[] = [];
  private lastClickedElementSelector: string = '';
  private lastClickTimestamp: number = 0;
  private isInitialized = false;

  public init() {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.isInitialized = true;

    this.setupClickTracker();
    this.setupFetchInterceptor();
    this.setupXHRInterceptor();
    this.setupErrorListeners();
  }

  private isRoutineAuthCheck(url: string, status: number): boolean {
    if (status === 401) {
      const cleanUrl = url.toLowerCase();
      if (
        cleanUrl.includes('/auth/me') ||
        cleanUrl.includes('/api/auth/me') ||
        cleanUrl.includes('/auth/status') ||
        cleanUrl.includes('/auth/session') ||
        cleanUrl.includes('/user/me') ||
        cleanUrl.includes('/api/me')
      ) {
        return true;
      }
    }
    return false;
  }

  private setupClickTracker() {
    document.addEventListener('click', (e) => {
      try {
        const target = e.target as HTMLElement;
        if (!target || target.closest('vibus-widget') || target.closest('vibeus-widget')) return;
        
        let selector = target.tagName.toLowerCase();
        if (target.id) selector += `#${target.id}`;
        if (target.className && typeof target.className === 'string') {
          const classes = target.className.split(/\s+/).filter(c => c && !c.includes(':')).slice(0, 3).join('.');
          if (classes) selector += `.${classes}`;
        }
        this.lastClickedElementSelector = selector;
        this.lastClickTimestamp = Date.now();
      } catch (err) {}
    }, true);
  }

  private setupFetchInterceptor() {
    const origFetch = window.fetch;
    const self = this;

    window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
      const startTime = performance.now();
      const timestamp = new Date().toISOString();
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      const isInternal = url.includes('/ws/') || url.includes('/widget.') || url.includes('/static/');
      const activeInitiator = (Date.now() - self.lastClickTimestamp < 3000) ? self.lastClickedElementSelector : undefined;
      let localCorrelationId: string | undefined;
      let fetchInput: RequestInfo | URL = input;
      let fetchInit: RequestInit | undefined = init;

      // For same-origin APIs generate the correlation id in the browser before the
      // request. This still correlates an unhandled 500 even when an outer server
      // error handler cannot attach a response header. Cross-origin requests are
      // not modified, avoiding surprise CORS preflights.
      if (!isInternal && isSameOriginRequest(url)) {
        try {
          const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
          localCorrelationId = headers.get('x-vibeus-request-id') || undefined;
          if (!localCorrelationId) {
            localCorrelationId = createCorrelationId();
            headers.set('X-VibeUs-Request-ID', localCorrelationId);
          }
          if (input instanceof Request) {
            fetchInput = new Request(input, { ...init, headers });
            fetchInit = undefined;
          } else {
            fetchInit = { ...init, headers };
          }
        } catch {}
      }

      try {
        const response = await origFetch.call(this, fetchInput, fetchInit);
        const durationMs = Math.round(performance.now() - startTime);

        if (!isInternal) {
          const isError = response.status >= 400;
          const routineAuth = self.isRoutineAuthCheck(url, response.status);
          const sanitizedUrl = safeUrl(url);
          let reqId: string | undefined = undefined;
          try {
            reqId = response.headers.get('x-vibeus-request-id') || response.headers.get('x-request-id') || undefined;
          } catch {}

          self.addNetworkLog({
            id: `net_${Math.random().toString(36).substring(2, 8)}`,
            timestamp,
            method,
            url: sanitizedUrl,
            status: response.status,
            statusText: response.statusText || (response.status === 200 ? 'OK' : 'Error'),
            durationMs,
            isError,
            isRoutineAuthCheck: routineAuth,
            initiatorSelector: activeInitiator,
            requestId: reqId || localCorrelationId || undefined,
          });
        }

        return response;
      } catch (err: any) {
        const durationMs = Math.round(performance.now() - startTime);
        if (!isInternal) {
          self.addNetworkLog({
            id: `net_${Math.random().toString(36).substring(2, 8)}`,
            timestamp,
            method,
            url: safeUrl(url),
            status: 0,
            statusText: 'Network Failed / Connection Refused',
            durationMs,
            isError: true,
            isRoutineAuthCheck: false,
            initiatorSelector: activeInitiator,
            requestId: localCorrelationId || undefined,
          });
        }
        throw err;
      }
    };
  }

  private setupXHRInterceptor() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const self = this;

    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
      (this as any)._vibeusMethod = method.toUpperCase();
      (this as any)._vibeusUrl = url.toString();
      (this as any)._vibeusStartTime = performance.now();
      (this as any)._vibeusSameOrigin = isSameOriginRequest(url.toString());
      (this as any)._vibeusRequestId = undefined;
      return origOpen.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name: string, value: string) {
      if (name.toLowerCase() === 'x-vibeus-request-id') {
        (this as any)._vibeusRequestId = value;
      }
      return origSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
      const xhr = this;
      const url = (xhr as any)._vibeusUrl || '';
      const isInternal = url.includes('/ws/') || url.includes('/widget.') || url.includes('/static/');
      let localCorrelationId = (xhr as any)._vibeusRequestId as string | undefined;
      if (!isInternal && (xhr as any)._vibeusSameOrigin && !localCorrelationId) {
        try {
          localCorrelationId = createCorrelationId();
          (xhr as any)._vibeusRequestId = localCorrelationId;
          origSetRequestHeader.call(xhr, 'X-VibeUs-Request-ID', localCorrelationId);
        } catch {}
      }

      xhr.addEventListener('loadend', () => {
        if (!isInternal) {
          const durationMs = Math.round(performance.now() - ((xhr as any)._vibeusStartTime || performance.now()));
          const status = xhr.status;
          const isError = status >= 400 || status === 0;
          const routineAuth = self.isRoutineAuthCheck(url, status);
          const activeInitiator = (Date.now() - self.lastClickTimestamp < 3000) ? self.lastClickedElementSelector : undefined;
          let reqId: string | undefined = undefined;
          try {
            reqId = xhr.getResponseHeader('x-vibeus-request-id') || xhr.getResponseHeader('x-request-id') || undefined;
          } catch {}

          self.addNetworkLog({
            id: `xhr_${Math.random().toString(36).substring(2, 8)}`,
            timestamp: new Date().toISOString(),
            method: (xhr as any)._vibeusMethod || 'GET',
            url: safeUrl(url),
            status,
            statusText: xhr.statusText || (status === 200 ? 'OK' : 'Error'),
            durationMs,
            isError,
            isRoutineAuthCheck: routineAuth,
            initiatorSelector: activeInitiator,
            requestId: reqId || localCorrelationId || undefined,
          });
        }
      });

      return origSend.apply(this, [body] as any);
    };
  }

  private setupErrorListeners() {
    const self = this;

    window.addEventListener('error', (e) => {
      self.addConsoleLog({
        id: `err_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        type: 'error',
        message: e.message || 'Uncaught JavaScript Exception',
        stack: e.error?.stack ? e.error.stack.slice(0, 400) : `${e.filename}:${e.lineno}:${e.colno}`
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason;
      self.addConsoleLog({
        id: `rej_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        type: 'error',
        message: `Unhandled Rejection: ${reason?.message || String(reason)}`,
        stack: reason?.stack ? reason.stack.slice(0, 400) : undefined
      });
    });

    const origConsoleError = console.error;
    console.error = function(...args: any[]) {
      try {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        if (!msg.includes('[Vibus') && !msg.includes('[VibeUs') && !msg.includes('WebSocket')) {
          self.addConsoleLog({
            id: `con_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            timestamp: new Date().toISOString(),
            type: 'error',
            message: msg.slice(0, 300)
          });
        }
      } catch (err) {}
      return origConsoleError.apply(this, args);
    };
  }

  private addNetworkLog(entry: NetworkLogEntry) {
    this.networkLogs.unshift(entry);
    if (this.networkLogs.length > MAX_NETWORK_LOGS) {
      this.networkLogs.pop();
    }
  }

  private addConsoleLog(entry: ConsoleLogEntry) {
    this.consoleLogs.unshift(entry);
    if (this.consoleLogs.length > MAX_CONSOLE_LOGS) {
      this.consoleLogs.pop();
    }
  }

  public getNetworkLogs(): NetworkLogEntry[] {
    return [...this.networkLogs];
  }

  public getConsoleLogs(): ConsoleLogEntry[] {
    return [...this.consoleLogs];
  }

  public removeNetworkLog(id: string) {
    this.networkLogs = this.networkLogs.filter(n => n.id !== id);
  }

  public removeConsoleLog(id: string) {
    this.consoleLogs = this.consoleLogs.filter(c => c.id !== id);
  }

  public clearAllLogs() {
    this.networkLogs = [];
    this.consoleLogs = [];
  }

  public getRecentErrors(includeRoutineAuth = false): { networkErrors: NetworkLogEntry[]; jsErrors: ConsoleLogEntry[] } {
    return {
      networkErrors: this.networkLogs.filter(n => n.isError && (includeRoutineAuth || !n.isRoutineAuthCheck)),
      jsErrors: this.consoleLogs.filter(c => c.type === 'error')
    };
  }

  public generateDiagnosticsMarkdown(
    customNetworkErrors?: NetworkLogEntry[],
    customJsErrors?: ConsoleLogEntry[],
    targetElement?: string
  ): string {
    const netErrors = customNetworkErrors || this.getRecentErrors(false).networkErrors;
    const jsErrors = customJsErrors || this.getRecentErrors(false).jsErrors;
    let md = '';

    if (netErrors.length > 0) {
      md += tr('v7.generated.network_context');
      netErrors.slice(0, 5).forEach((net) => {
        const icon = net.status >= 500 ? '❌' : net.status === 0 ? '🔌' : '⚠️';
        const initiatorStr = net.initiatorSelector ? tr('v7.generated.click_on', { selector: net.initiatorSelector }) : '';
        const reqIdStr = net.requestId ? ` [req_id: \`${net.requestId}\`]` : '';
        md += `- ${icon} \`${net.method} ${net.url}\` -> **${net.status || 'FAIL'} ${net.statusText}** (${net.durationMs}ms)${initiatorStr}${reqIdStr}\n`;
      });
    }

    if (jsErrors.length > 0) {
      md += tr('v7.generated.console_errors');
      jsErrors.slice(0, 3).forEach((err) => {
        md += `- 🔴 \`${err.message}\`\n`;
        if (err.stack) {
          md += `  \`\`\`text\n  ${err.stack.split('\n').slice(0, 3).join('\n  ')}\n  \`\`\`\n`;
        }
      });
    }

    return md;
  }

  public getErrorForElement(selector: string): NetworkLogEntry | undefined {
    return this.networkLogs.find(n => n.isError && !n.isRoutineAuthCheck && n.initiatorSelector === selector);
  }

  public detect500Spike(): { hasSpike: boolean; endpoint?: string | undefined; count?: number | undefined; sampleLog?: NetworkLogEntry | undefined } {
    const recent500s = this.networkLogs.filter(n => n.status >= 500);
    if (recent500s.length >= 2) {
      const endpointMap: Record<string, number> = {};
      for (const req of recent500s) {
        endpointMap[req.url] = (endpointMap[req.url] || 0) + 1;
      }
      for (const [url, count] of Object.entries(endpointMap)) {
        if (count >= 2) {
          const sample = recent500s.find(n => n.url === url);
          return { hasSpike: true, endpoint: url, count, sampleLog: sample };
        }
      }
    }
    return { hasSpike: false };
  }
}

export const telemetry = new TelemetryCollector();