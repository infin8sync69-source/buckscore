"""
Bearer-token gate for the agent's localhost HTTP servers (Soul Engine, MCP).

Why: these servers listen on 127.0.0.1, but every web page the user opens can
send requests to 127.0.0.1 too. With no authentication and CORS "*", any site
could drive the agent: run its tools, read granted files, publish to IPFS. A
loopback bind is not an access control.

How: the process that starts the server (the Bucks Browser main process)
generates a random token per launch and passes it in the environment
(BUCKS_SOUL_TOKEN for the Soul Engine, BUCKS_MCP_TOKEN for the MCP server).
Every request must then carry `Authorization: Bearer <token>`; a WebSocket
handshake may send it as the `token` query parameter instead, because browser
WebSocket clients cannot set headers. A page never learns the token, so it is
refused with 401.

`GET /health` stays open so a supervisor can tell "our engine is up" from
"something else holds the port". It reveals the model name and mode only.

Without a token in the environment (a developer running uvicorn by hand, or the
older Bucks-App launcher) the gate is off and a warning is logged, so existing
setups keep working. CORS follows the same rule: "*" only in that legacy mode,
nothing by default once a token is set, or the explicit list in
`<PREFIX>_CORS_ORIGINS` (comma-separated).
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Any, Awaitable, Callable
from urllib.parse import parse_qs

log = logging.getLogger("local-auth")

OPEN_PATHS = frozenset({"/health"})

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


def _header(scope: Scope, name: bytes) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == name:
            return value.decode("latin-1")
    return ""


def presented_token(scope: Scope) -> str:
    """The token a request carries: the Bearer header, or `?token=` on a WebSocket."""
    auth = _header(scope, b"authorization")
    if auth[:7].lower() == "bearer ":
        return auth[7:].strip()
    if scope.get("type") == "websocket":
        query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
        return (query.get("token") or [""])[0]
    return ""


def is_open(scope: Scope) -> bool:
    return scope.get("type") == "http" and scope.get("method") in ("GET", "HEAD") and scope.get("path") in OPEN_PATHS


class BearerTokenMiddleware:
    """Pure ASGI middleware, so streaming (SSE) responses pass through untouched."""

    def __init__(self, app: Callable[..., Awaitable[None]], token: str) -> None:
        if not token:
            raise ValueError("BearerTokenMiddleware needs a non-empty token")
        self.app = app
        self._token = token.encode("utf-8")

    def authorized(self, scope: Scope) -> bool:
        if is_open(scope):
            return True
        return hmac.compare_digest(presented_token(scope).encode("utf-8"), self._token)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") not in ("http", "websocket") or self.authorized(scope):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return
        body = b'{"error":"unauthorized"}'
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"www-authenticate", b"Bearer"),
            ],
        })
        await send({"type": "http.response.body", "body": body})


def cors_origins(prefix: str, token: str) -> list[str]:
    raw = os.getenv(f"{prefix}_CORS_ORIGINS")
    if raw is not None:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [] if token else ["*"]


def install(app: Any, prefix: str = "BUCKS_SOUL") -> bool:
    """Add the token gate and the CORS policy to a FastAPI/Starlette app.

    Reads `<prefix>_TOKEN` and `<prefix>_CORS_ORIGINS`. Returns True when the
    gate is on. CORS is added last so it is the outermost layer and answers
    preflight requests before the token check.
    """
    token = os.getenv(f"{prefix}_TOKEN", "").strip()
    if token:
        app.add_middleware(BearerTokenMiddleware, token=token)
    else:
        log.warning("%s_TOKEN is not set: this server accepts requests from any local process "
                    "and any web page. The Bucks Browser always sets it.", prefix)
    origins = cors_origins(prefix, token)
    if origins:
        from fastapi.middleware.cors import CORSMiddleware
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
    return bool(token)
