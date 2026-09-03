"""
Vibus OpenSpec — Live Preview Tunnel Gateway
Управляет защищенными туннелями между локальным dev-сервером разработчика (localhost)
и облачным шлюзом Vibus для демонстрации проекта заказчикам без деплоя на стенд.
"""

import asyncio
import base64
import json
import logging
import time
import uuid
from typing import Dict, Optional, Any
from fastapi import WebSocket, WebSocketDisconnect, Request, Response, HTTPException

import re
from settings import get_settings

logger = logging.getLogger("vibus.tunnel")

# Maximum response body size for tunnel streaming: 25 MB
MAX_TUNNEL_PAYLOAD_BYTES = 5 * 1024 * 1024  # 5 MB decoded request/response limit
MAX_TUNNEL_WS_FRAME_BYTES = 8 * 1024 * 1024  # includes JSON/base64 overhead
TUNNEL_REQUEST_TIMEOUT_SECONDS = 30.0


def rewrite_tunnel_content(content_type: str, content: bytes, tunnel_id: str, project_id: Optional[str] = None) -> bytes:
    """
    Smart rewriter for subpath tunnel reverse proxying.
    Rewrites root-relative URLs in HTML, JS (Vite/ES modules), and CSS so they stay within /preview/{tunnel_id}/.
    """
    ct_lower = content_type.lower()
    cloud_base_url = str(get_settings().preview_base_url).rstrip('/')
    
    # 1. HTML Responses
    if "text/html" in ct_lower:
        try:
            html = content.decode('utf-8', errors='ignore')
            
            interceptor_script = f"""<script>
(function() {{
  const prefix = "/preview/{tunnel_id}";
  
  // 1. Intercept window.fetch for dynamic runtime API calls (exempt cloud API and WS)
  const origFetch = window.fetch;
  window.fetch = function(url, options) {{
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('/preview/')) {{
      url = prefix + url;
    }} else if (url instanceof Request && url.url && url.url.startsWith('/') && !url.url.startsWith('/preview/')) {{
      url = new Request(prefix + url.url, url);
    }}
    return origFetch.call(this, url, options);
  }};

  // 2. Intercept XMLHttpRequest for Axios / jQuery / XHR
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {{
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('/preview/')) {{
      url = prefix + url;
    }}
    return origOpen.call(this, method, url, ...rest);
  }};

  // 3. Intercept history.pushState & history.replaceState for SPA routers (React Router, Next.js, Vue Router)
  const origPushState = history.pushState;
  history.pushState = function(state, title, url) {{
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('/preview/')) {{
      url = prefix + (url === '/' ? '/' : url);
    }}
    return origPushState.call(this, state, title, url);
  }};

  const origReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {{
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('/preview/')) {{
      url = prefix + (url === '/' ? '/' : url);
    }}
    return origReplaceState.call(this, state, title, url);
  }};

  // 4. Intercept link clicks to keep navigation inside tunnel
  document.addEventListener('click', function(e) {{
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && a.getAttribute('href')) {{
      const href = a.getAttribute('href');
      if (href.startsWith('/') && !href.startsWith('/preview/') && !href.startsWith('//')) {{
        a.setAttribute('href', prefix + href);
      }}
    }}
  }}, true);

  // 5. Intercept dynamic <img> src and <source> srcset in React / DOM
  try {{
    const origImgSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (origImgSrc && origImgSrc.set) {{
      Object.defineProperty(HTMLImageElement.prototype, 'src', {{
        set: function(val) {{
          if (typeof val === 'string' && val.startsWith('/') && !val.startsWith('/preview/') && !val.startsWith('//')) {{
            val = prefix + val;
          }}
          return origImgSrc.set.call(this, val);
        }},
        get: origImgSrc.get,
        configurable: true
      }});
    }}
  }} catch(e) {{}}

  // 6. Suppress Dev Server HMR WebSockets (Vite, Turbopack, Webpack) on remote preview without breaking VibeUs sync
  const OrigWS = window.WebSocket;
  const PatchedWS = function(url, protocols) {{
    const urlStr = typeof url === 'string' ? url : (url && url.url ? String(url.url) : '');
    
    // Allow real WebSocket connections only for VibeUs cloud sync and tunnel multiplexing
    if (urlStr.includes('/ws/sync/') || urlStr.includes('/ws/tunnel/')) {{
      return protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    }}
    
    // Clean silent dummy WebSocket for Vite/HMR to prevent failed connection errors & reconnect loops
    const dummy = new EventTarget();
    dummy.readyState = 1; // WebSocket.OPEN
    dummy.bufferedAmount = 0;
    dummy.extensions = "";
    dummy.protocol = "";
    dummy.binaryType = "blob";
    dummy.url = urlStr;
    dummy.onopen = null;
    dummy.onmessage = null;
    dummy.onerror = null;
    dummy.onclose = null;
    dummy.send = function() {{}};
    dummy.close = function() {{}};
    
    setTimeout(() => {{
      try {{
        if (typeof dummy.onopen === 'function') {{
          dummy.onopen(new Event('open'));
        }}
        dummy.dispatchEvent(new Event('open'));
      }} catch(e) {{}}
    }}, 0);
    
    return dummy;
  }};
  PatchedWS.CONNECTING = 0;
  PatchedWS.OPEN = 1;
  PatchedWS.CLOSING = 2;
  PatchedWS.CLOSED = 3;
  PatchedWS.prototype = OrigWS.prototype;
  window.WebSocket = PatchedWS;
}})();
</script>"""

            # Rewrite root-relative src and href attributes (except external / static / widget / api / ws)
            html = re.sub(
                r'(src|href)=([\'"])/((?!preview/|http://|https://|//).*?)([\'"])',
                rf'\1=\2/preview/{tunnel_id}/\3\4',
                html
            )
            
            # Rewrite inline ES module imports
            html = re.sub(r'from\s+([\'"])/((?!preview/).*?)([\'"])', rf'from \1/preview/{tunnel_id}/\2\3', html)
            html = re.sub(r'import\s+([\'"])/((?!preview/).*?)([\'"])', rf'import \1/preview/{tunnel_id}/\2\3', html)
            html = re.sub(r'import\s*\(\s*([\'"])/((?!preview/).*?)([\'"])\s*\)', rf'import(\1/preview/{tunnel_id}/\2\3)', html)
            
            # Inject interceptor at top of <head>
            if "<head>" in html:
                html = html.replace("<head>", f"<head>\n{interceptor_script}", 1)
            elif "<HEAD>" in html:
                html = html.replace("<HEAD>", f"<HEAD>\n{interceptor_script}", 1)
            else:
                html = interceptor_script + html

            # Inject widget script if </head> present
            if "vibus" not in html.lower() and "</head>" in html:
                widget_tag = f"""
<!-- Vibus Live Review Widget Auto-Injected -->
<script src="{cloud_base_url}/static/vibus-widget.umd.cjs?v={int(time.time())}" data-project="{project_id or tunnel_id}" data-server="{cloud_base_url}" data-mode="client_preview" data-theme="dark" async></script>
</head>"""
                html = html.replace("</head>", widget_tag, 1)
            
            return html.encode('utf-8')
        except Exception as e:
            logger.warning(f"HTML rewrite error in tunnel {tunnel_id}: {e}")
            return content

    # 2. JavaScript / ES Modules Responses (Vite dev client, React components, chunks)
    if any(js_t in ct_lower for js_t in ("javascript", "application/javascript", "text/javascript", "application/x-javascript")):
        try:
            js = content.decode('utf-8', errors='ignore')
            
            # Rewrite root-relative module import specifiers
            js = re.sub(r'from\s+([\'"])/((?!preview/).*?)([\'"])', rf'from \1/preview/{tunnel_id}/\2\3', js)
            js = re.sub(r'import\s+([\'"])/((?!preview/).*?)([\'"])', rf'import \1/preview/{tunnel_id}/\2\3', js)
            js = re.sub(r'import\s*\(\s*([\'"])/((?!preview/).*?)([\'"])\s*\)', rf'import(\1/preview/{tunnel_id}/\2\3)', js)
            
            # Auto-configure basename for React Router (<BrowserRouter>) so SPA routes match inside /preview/{tunnel_id}/
            js = re.sub(
                r'(function\s+BrowserRouter\s*\(\s*\{[\s\S]*?\}\s*\)\s*\{)',
                r'\1\n  basename = basename || (typeof window !== "undefined" ? (window.location.pathname.match(/^\\/preview\\/[^\\/]+/) || [""])[0] : "");',
                js
            )

            # Auto-strip tunnel prefix in createBrowserLocation
            js = re.sub(
                r'let\s*\{\s*pathname\s*,\s*search\s*,\s*hash\s*\}\s*=\s*(maskedLocation\s*\|\|\s*window2\.location)\s*;',
                r'let { pathname: _rawP, search, hash } = \1; let pathname = _rawP.startsWith("/preview/") ? (_rawP.replace(/^\\/preview\\/[^\\/]+/, "") || "/") : _rawP;',
                js
            )

            # Virtualize window.location.pathname getter for other SPA client-side routers
            js = re.sub(r'\bwindow\.location\.pathname\b(?!\s*=)', r"(window.location.pathname.startsWith('/preview/') ? (window.location.pathname.replace(/^\/preview\/[^\/]+/, '') || '/') : window.location.pathname)", js)

            return js.encode('utf-8')
        except Exception as e:
            logger.warning(f"JS rewrite error in tunnel {tunnel_id}: {e}")
            return content

    # 3. CSS Responses
    if "text/css" in ct_lower:
        try:
            css = content.decode('utf-8', errors='ignore')
            css = re.sub(r'url\s*\(\s*([\'"]?)/((?!preview/|http://|https://|//).*?)([\'"]?)\s*\)', rf'url(\1/preview/{tunnel_id}/\2\3)', css)
            return css.encode('utf-8')
        except Exception:
            return content

    return content


DISCLAIMER_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VibeUs — Предупреждение безопасности</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background-color: #08090d;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow-x: hidden;
    }}
    .ambient-glow {{
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.05) 50%, transparent 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 0;
    }}
    .card {{
      position: relative;
      z-index: 1;
      max-width: 520px;
      width: 100%;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 36px 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    }}
    .badge-header {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.25);
      color: #fbbf24;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 12px;
      border-radius: 100px;
      margin-bottom: 20px;
    }}
    .badge-pulse {{
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #fbbf24;
      box-shadow: 0 0 8px #fbbf24;
      animation: pulse 2s infinite;
    }}
    @keyframes pulse {{
      0%, 100% {{ opacity: 1; }}
      50% {{ opacity: 0.4; }}
    }}
    h1 {{
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      color: #ffffff;
      line-height: 1.3;
    }}
    p.desc {{
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 24px;
    }}
    .warning-box {{
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 24px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }}
    .warning-icon {{
      flex-shrink: 0;
      color: #f87171;
      margin-top: 2px;
    }}
    .warning-text {{
      font-size: 13px;
      color: #fca5a5;
      line-height: 1.5;
    }}
    .warning-text strong {{
      color: #ffffff;
      font-weight: 700;
    }}
    .meta-table {{
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 28px;
      font-size: 12px;
    }}
    .meta-row {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
    }}
    .meta-row:not(:last-child) {{
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      padding-bottom: 8px;
      margin-bottom: 8px;
    }}
    .meta-label {{
      color: #64748b;
      font-weight: 500;
    }}
    .meta-value {{
      color: #cbd5e1;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }}
    .btn-proceed {{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
      color: #ffffff;
      border: none;
      border-radius: 14px;
      padding: 14px 20px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(79, 70, 229, 0.4);
      transition: all 0.2s ease;
      text-decoration: none;
    }}
    .btn-proceed:hover {{
      background: linear-gradient(135deg, #4338ca 0%, #4f46e5 100%);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.5);
    }}
    .footer-note {{
      text-align: center;
      margin-top: 18px;
      font-size: 11px;
      color: #475569;
    }}
    .footer-note a {{
      color: #818cf8;
      text-decoration: none;
    }}
    .footer-note a:hover {{
      text-decoration: underline;
    }}
  </style>
</head>
<body>
  <div class="ambient-glow"></div>
  <div class="card">
    <div class="badge-header">
      <span class="badge-pulse"></span>
      Тестовый стенд разработки
    </div>
    
    <h1>Вы переходите на Live-стенд</h1>
    <p class="desc">
      Этот веб-интерфейс временно транслируется с локального компьютера разработчика через шлюз <strong>VibeUs Live Share</strong>.
    </p>

    <div class="warning-box">
      <svg class="warning-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div class="warning-text">
        <strong>Правило безопасности:</strong> Не вводите на этой тестовой странице свои реальные пароли, данные банковских карт и личные секреты.
      </div>
    </div>

    <div class="meta-table">
      <div class="meta-row">
        <span class="meta-label">Проект</span>
        <span class="meta-value">{project_id}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">ID туннеля</span>
        <span class="meta-value">{tunnel_id}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Шлюз</span>
        <span class="meta-value">vibeus.pro (SSL Secured)</span>
      </div>
    </div>

    <button class="btn-proceed" onclick="acceptAndProceed()">
      <span>Я понимаю риск — Перейти к просмотру</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14"/>
        <path d="m12 5 7 7-7 7"/>
      </svg>
    </button>

    <p class="footer-note">
      Платформа <a href="https://vibeus.pro" target="_blank">VibeUs</a> • <a href="mailto:abuse@vibeus.pro">Пожаловаться на фишинг</a>
    </p>
  </div>

  <script>
    function acceptAndProceed() {{
      // Set acknowledgment cookie for 24 hours
      document.cookie = "vibeus_ack_{tunnel_id}=1; path=/preview/{tunnel_id}/; max-age=86400; SameSite=Lax";
      window.location.reload();
    }}
  </script>
</body>
</html>
"""


class TunnelSession:
    def __init__(self, tunnel_id: str, websocket: WebSocket, project_id: Optional[str] = None, local_port: int = 5173):
        self.tunnel_id = tunnel_id
        self.websocket = websocket
        self.project_id = project_id
        self.local_port = local_port
        self.created_at = time.time()
        self.last_active = time.time()
        self.pending_requests: Dict[str, asyncio.Future] = {}
        self.total_requests = 0

    def touch(self):
        self.last_active = time.time()


class TunnelGatewayManager:
    def __init__(self):
        self.active_tunnels: Dict[str, TunnelSession] = {}
        self.authorized_tunnels: Dict[str, dict] = {}  # tunnel_id -> {secret, project_id}
        self._cleanup_task: Optional[asyncio.Task] = None

    def issue_tunnel(self, project_id: str) -> dict:
        import secrets
        t_id = 't-' + secrets.token_hex(6)
        t_secret = secrets.token_hex(16)
        self.authorized_tunnels[t_id] = {'secret': t_secret, 'project_id': project_id}
        return {"tunnel_id": t_id, "tunnel_secret": t_secret}


    async def register_tunnel(self, tunnel_id: str, websocket: WebSocket, project_id: Optional[str] = None, local_port: int = 5173) -> TunnelSession:
        session = TunnelSession(tunnel_id, websocket, project_id, local_port)
        self.active_tunnels[tunnel_id] = session
        try:
            await websocket.send_json({"type": "tunnel.ready", "tunnel_id": tunnel_id})
        except Exception:
            pass
        logger.info(f"⚡ [TUNNEL OPENED] ID: {tunnel_id} -> localhost:{local_port} (Project: {project_id})")
        return session

    def unregister_tunnel(self, tunnel_id: str):
        if tunnel_id in self.active_tunnels:
            session = self.active_tunnels.pop(tunnel_id)
            # Cancel all pending requests
            for req_id, future in session.pending_requests.items():
                if not future.done():
                    future.set_exception(HTTPException(status_code=502, detail="Tunnel disconnected by developer"))
            logger.info(f"🔌 [TUNNEL CLOSED] ID: {tunnel_id}")

    async def handle_cli_message(self, tunnel_id: str, message_str: str):
        session = self.active_tunnels.get(tunnel_id)
        if not session:
            return

        session.touch()
        try:
            payload = json.loads(message_str)
        except Exception as e:
            logger.warning(f"Invalid JSON from CLI tunnel {tunnel_id}: {e}")
            return

        msg_type = payload.get("type")

        # Response from local dev server
        if msg_type == "http_response":
            req_id = payload.get("request_id")
            if req_id and req_id in session.pending_requests:
                future = session.pending_requests.pop(req_id)
                if not future.done():
                    future.set_result(payload)

        elif msg_type == "ping":
            try:
                await session.websocket.send_json({"type": "pong", "timestamp": time.time()})
            except Exception:
                pass

    async def proxy_http_request(self, tunnel_id: str, request: Request, path: str = "", is_subdomain: bool = False) -> Response:
        session = self.active_tunnels.get(tunnel_id)
        if not session:
            raise HTTPException(
                status_code=404,
                detail=f"Туннель '{tunnel_id}' не найден или разработчик отключил локальный сервер."
            )

        session.touch()
        session.total_requests += 1

        # Check Interstitial Disclaimer for root HTML navigation requests
        is_static_asset = any(path.lower().endswith(ext) for ext in ('.js', '.mjs', '.css', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico', '.json', '.woff', '.woff2', '.map', '.ts', '.tsx'))
        is_html_navigation = (
            request.method == "GET" and
            not is_static_asset and
            (not path or path.strip("/") in ("", "index.html", "landing", "login", "app"))
        )

        ack_cookie = request.cookies.get(f"vibeus_ack_{tunnel_id}")
        has_bypass_param = request.query_params.get("vibeus_ack") == "1" or request.query_params.get("skip_disclaimer") == "1"

        if is_html_navigation and not ack_cookie and not has_bypass_param:
            disclaimer_html = DISCLAIMER_HTML_TEMPLATE.format(
                project_id=session.project_id or "Local Dev",
                tunnel_id=tunnel_id
            )
            return Response(
                content=disclaimer_html.encode('utf-8'),
                status_code=200,
                media_type="text/html; charset=utf-8"
            )

        req_id = str(uuid.uuid4())
        req_future = asyncio.get_running_loop().create_future()
        session.pending_requests[req_id] = req_future

        # Read body if present
        body_bytes = await request.body()
        is_binary_request = False
        body_str = None

        if body_bytes:
            if len(body_bytes) > MAX_TUNNEL_PAYLOAD_BYTES:
                session.pending_requests.pop(req_id, None)
                raise HTTPException(status_code=413, detail="Payload Too Large for Tunnel")
            
            try:
                body_str = body_bytes.decode('utf-8')
            except UnicodeDecodeError:
                body_str = base64.b64encode(body_bytes).decode('ascii')
                is_binary_request = True

        # Extract headers with strict security filtering
        filtered_headers = {}
        # Block cookies, credentials and hop-by-hop headers from leaking into localhost
        BLOCKED_REQUEST_HEADERS = {
            'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
            'cookie', 'authorization', 'proxy-authorization', 'x-forwarded-for'
        }
        for k, v in request.headers.items():
            if k.lower() not in BLOCKED_REQUEST_HEADERS:
                filtered_headers[k.lower()] = v

        # Build normalized target path with query string
        clean_path = f"/{path.lstrip('/')}" if path else "/"
        if request.url.query:
            clean_path = f"{clean_path}?{request.url.query}"

        # Dispatch request message over WebSocket to CLI
        tunnel_req_message = {
            "type": "http_request",
            "request_id": req_id,
            "method": request.method,
            "path": clean_path,
            "headers": filtered_headers,
            "body": body_str,
            "is_base64": is_binary_request
        }

        try:
            await session.websocket.send_json(tunnel_req_message)
        except Exception as send_err:
            session.pending_requests.pop(req_id, None)
            logger.error(f"Failed to send HTTP request to tunnel {tunnel_id}: {send_err}")
            raise HTTPException(status_code=502, detail="Не удалось отправить запрос в локальный туннель")

        # Await response from CLI with timeout
        try:
            cli_res = await asyncio.wait_for(req_future, timeout=TUNNEL_REQUEST_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            session.pending_requests.pop(req_id, None)
            raise HTTPException(status_code=504, detail="Gateway Timeout: локальный сервер разработчика не ответил вовремя")
        except Exception as e:
            session.pending_requests.pop(req_id, None)
            raise HTTPException(status_code=502, detail=f"Ошибка туннеля: {str(e)}")

        status_code = cli_res.get("status_code", 200)
        res_headers = cli_res.get("headers", {})
        raw_res_body = cli_res.get("body", "")
        res_is_base64 = cli_res.get("is_base64", False)

        try:
            if res_is_base64 and raw_res_body:
                final_content = base64.b64decode(raw_res_body, validate=True)
            else:
                final_content = raw_res_body.encode('utf-8') if isinstance(raw_res_body, str) else raw_res_body
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Invalid encoded response from local tunnel") from exc

        if final_content is None:
            final_content = b""
        if not isinstance(final_content, (bytes, bytearray)):
            raise HTTPException(status_code=502, detail="Invalid response body from local tunnel")
        if len(final_content) > MAX_TUNNEL_PAYLOAD_BYTES:
            raise HTTPException(status_code=502, detail="Local response exceeds 5 MB tunnel limit")

        content_type = res_headers.get("content-type") or res_headers.get("Content-Type") or "text/html; charset=utf-8"

        # Content-Type correction for modern JS bundlers / ES modules
        clean_path_lower = path.lower()
        if any(clean_path_lower.endswith(ext) for ext in ('.js', '.mjs', '.ts', '.tsx', '.jsx')) or '@vite' in clean_path_lower or '@react-refresh' in clean_path_lower:
            if "text/html" in content_type:
                content_type = "application/javascript; charset=utf-8"
        elif clean_path_lower.endswith('.css') and "text/html" in content_type:
            content_type = "text/css; charset=utf-8"
        elif clean_path_lower.endswith('.svg') and "text/html" in content_type:
            content_type = "image/svg+xml"

        # Apply smart subpath URL rewriting for HTML, JS and CSS
        if isinstance(final_content, bytes):
            if not is_subdomain:
                final_content = rewrite_tunnel_content(content_type, final_content, tunnel_id, session.project_id)
        elif "text/html" in content_type:
            html = final_content.decode('utf-8', errors='ignore')
            if "vibus" not in html.lower() and "</head>" in html:
                cloud_base_url = str(get_settings().preview_base_url).rstrip('/')
                widget_tag = f"\n<!-- Vibus Auto-Injected -->\n<script src=\"{cloud_base_url}/static/vibus-widget.umd.cjs?v={int(time.time())}\" data-project=\"{session.project_id or tunnel_id}\" data-server=\"{cloud_base_url}\" data-mode=\"client_preview\" data-theme=\"dark\" async></script>\n</head>"
                html = html.replace("</head>", widget_tag, 1)
            final_content = html.encode('utf-8')

        # Prepare sanitized response headers (block set-cookie and dangerous headers)
        BLOCKED_RESPONSE_HEADERS = {
            'content-type', 'content-length', 'transfer-encoding', 'connection',
            'content-encoding', 'set-cookie', 'clear-site-data'
        }
        clean_res_headers = {}
        for hk, hv in res_headers.items():
            if hk.lower() not in BLOCKED_RESPONSE_HEADERS:
                clean_res_headers[hk] = hv

        # Add origin isolation & security headers
        clean_res_headers['X-Content-Type-Options'] = 'nosniff'
        clean_res_headers['X-Frame-Options'] = 'SAMEORIGIN'
        clean_res_headers['Content-Security-Policy'] = "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src * ws: wss:; frame-ancestors 'none'; object-src 'none'"
        clean_res_headers['Referrer-Policy'] = 'no-referrer'
        clean_res_headers['Cache-Control'] = 'no-store'

        return Response(
            content=final_content,
            status_code=status_code,
            headers=clean_res_headers,
            media_type=content_type
        )

# Global singleton tunnel manager
tunnel_gateway = TunnelGatewayManager()
