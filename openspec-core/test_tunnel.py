import pytest
import asyncio
import json
from unittest.mock import AsyncMock
from fastapi import Request, HTTPException
from starlette.datastructures import Headers, URL
from starlette.testclient import TestClient

from main import app
from tunnel import TunnelGatewayManager, TunnelSession, tunnel_gateway

def test_tunnel_endpoint_not_found():
    client = TestClient(app)
    response = client.get("/preview/unknown_tunnel_999/index.html")
    assert response.status_code == 401
    assert "Preview session required" in response.json()["error"]["message"]

@pytest.mark.asyncio
async def test_tunnel_gateway_lifecycle():
    gateway = TunnelGatewayManager()
    mock_ws = AsyncMock()
    mock_ws.accept = AsyncMock()
    mock_ws.send_json = AsyncMock()

    # 1. Register tunnel
    session = await gateway.register_tunnel("tkn_alpha_1", mock_ws, "proj_demo", 3000)
    assert "tkn_alpha_1" in gateway.active_tunnels
    assert session.local_port == 3000
    assert session.project_id == "proj_demo"
    mock_ws.send_json.assert_called_once()

    # 2. Ping / Pong
    await gateway.handle_cli_message("tkn_alpha_1", json.dumps({"type": "ping"}))
    assert mock_ws.send_json.call_count == 2
    pong_payload = mock_ws.send_json.call_args[0][0]
    assert pong_payload["type"] == "pong"

    # 3. Unregister
    gateway.unregister_tunnel("tkn_alpha_1")
    assert "tkn_alpha_1" not in gateway.active_tunnels

@pytest.mark.asyncio
async def test_tunnel_proxy_get_with_widget_injection():
    gateway = TunnelGatewayManager()
    mock_ws = AsyncMock()
    mock_ws.accept = AsyncMock()
    mock_ws.send_json = AsyncMock()

    await gateway.register_tunnel("tkn_beta_2", mock_ws, "proj_test", 5173)

    # Mock incoming HTTP Request
    mock_request = AsyncMock(spec=Request)
    mock_request.method = "GET"
    mock_request.headers = Headers({"user-agent": "Chrome/120.0", "host": "preview.vibus.dev"})
    mock_request.url = URL("https://preview.vibus.dev/preview/tkn_beta_2/about?ref=share")
    mock_request.body = AsyncMock(return_value=b"")

    # Start dispatching request
    proxy_task = asyncio.create_task(gateway.proxy_http_request("tkn_beta_2", mock_request, "about"))
    await asyncio.sleep(0.01)

    # Check that HTTP request was sent to WebSocket
    assert mock_ws.send_json.call_count == 2
    sent_msg = mock_ws.send_json.call_args[0][0]
    assert sent_msg["type"] == "http_request"
    assert sent_msg["method"] == "GET"
    assert sent_msg["path"] == "/about?ref=share"
    req_id = sent_msg["request_id"]

    # Simulate CLI returning HTML page
    await gateway.handle_cli_message("tkn_beta_2", json.dumps({
        "type": "http_response",
        "request_id": req_id,
        "status_code": 200,
        "headers": {"content-type": "text/html; charset=utf-8"},
        "body": "<html><head><title>My App</title></head><body><h1>Welcome</h1></body></html>",
        "is_base64": False
    }))

    response = await proxy_task
    assert response.status_code == 200
    assert b"Welcome" in response.body
    # Check that Vibus review widget was auto-injected before </head>
    assert b"Vibus Live Review Widget Auto-Injected" in response.body
    assert b"vibus-widget.umd.cjs" in response.body

@pytest.mark.asyncio
async def test_tunnel_proxy_post_json():
    gateway = TunnelGatewayManager()
    mock_ws = AsyncMock()
    mock_ws.accept = AsyncMock()
    mock_ws.send_json = AsyncMock()

    await gateway.register_tunnel("tkn_gamma_3", mock_ws, "proj_test", 8000)

    mock_request = AsyncMock(spec=Request)
    mock_request.method = "POST"
    mock_request.headers = Headers({"content-type": "application/json", "host": "preview.vibus.dev"})
    mock_request.url = URL("https://preview.vibus.dev/preview/tkn_gamma_3/api/feedback")
    mock_request.body = AsyncMock(return_value=b'{"rating": 5, "comment": "Great!"}')

    proxy_task = asyncio.create_task(gateway.proxy_http_request("tkn_gamma_3", mock_request, "api/feedback"))
    await asyncio.sleep(0.01)

    sent_msg = mock_ws.send_json.call_args[0][0]
    assert sent_msg["type"] == "http_request"
    assert sent_msg["method"] == "POST"
    assert "Great!" in sent_msg["body"]
    req_id = sent_msg["request_id"]

    await gateway.handle_cli_message("tkn_gamma_3", json.dumps({
        "type": "http_response",
        "request_id": req_id,
        "status_code": 201,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"status": "received", "id": 101}),
        "is_base64": False
    }))

    response = await proxy_task
    assert response.status_code == 201
    assert json.loads(response.body) == {"status": "received", "id": 101}

def test_tunnel_interceptor_script_preserves_websocket_and_proxies_local_api():
    from tunnel import rewrite_tunnel_content
    raw_html = b"<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>"
    rewritten = rewrite_tunnel_content("text/html", raw_html, "tkn_test_123", "proj_test").decode("utf-8")
    
    # Assert WebSocket static properties are preserved
    assert "PatchedWS.OPEN = 1" in rewritten
    assert "PatchedWS.CONNECTING = 0" in rewritten
    assert "PatchedWS.CLOSED = 3" in rewritten
    assert "PatchedWS.prototype = OrigWS.prototype" in rewritten
    
    # Local application API calls must stay inside the preview prefix. VibeUs
    # cloud calls use the injected widget's absolute data-server URL instead.
    assert "url = prefix + url" in rewritten
    assert "!url.startsWith('/api/')" not in rewritten
    assert "data-project=\"proj_test\"" in rewritten


@pytest.mark.asyncio
async def test_tunnel_rejects_oversized_local_response_body():
    from tunnel import MAX_TUNNEL_PAYLOAD_BYTES

    gateway = TunnelGatewayManager()
    mock_ws = AsyncMock()
    mock_ws.accept = AsyncMock()
    mock_ws.send_json = AsyncMock()
    await gateway.register_tunnel("tkn_large_4", mock_ws, "proj_test", 5173)

    mock_request = AsyncMock(spec=Request)
    mock_request.method = "GET"
    mock_request.headers = Headers({"host": "preview.example"})
    mock_request.url = URL("https://preview.example/preview/tkn_large_4/large.txt")
    mock_request.body = AsyncMock(return_value=b"")

    proxy_task = asyncio.create_task(gateway.proxy_http_request("tkn_large_4", mock_request, "large.txt"))
    await asyncio.sleep(0.01)
    req_id = mock_ws.send_json.call_args[0][0]["request_id"]

    await gateway.handle_cli_message("tkn_large_4", json.dumps({
        "type": "http_response",
        "request_id": req_id,
        "status_code": 200,
        "headers": {"content-type": "text/plain"},
        "body": "x" * (MAX_TUNNEL_PAYLOAD_BYTES + 1),
        "is_base64": False,
    }))

    with pytest.raises(HTTPException) as exc:
        await proxy_task
    assert exc.value.status_code == 502
    assert "exceeds 5 MB" in str(exc.value.detail)
