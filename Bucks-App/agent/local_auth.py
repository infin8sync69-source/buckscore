"""
Shared-secret authentication for the local agent servers.

The Soul Engine (:8765) and the MCP server (:9999) listen on loopback and
expose tools that read project files, sign payloads with the soul key and
publish to IPFS. Loopback alone is not a boundary: any web page open in any
browser on this machine can send requests to 127.0.0.1, and a DNS-rebinding
page can even make them same-origin. So every request (except /health, which
the supervisors poll before they know whether an engine is theirs) must carry

    Authorization: Bearer <token>

The token lives in ~/.bucks/agent.token (mode 0600), or BUCKS_AGENT_TOKEN_FILE.
Electron reads or creates the same file and passes it to the engines it spawns
through BUCKS_AGENT_TOKEN, so an engine the user started by hand and the one
the app spawns always agree. Processes running as the same user can read the
file — that is the same trust level they already have over everything else
the user owns.
"""
from __future__ import annotations

import hmac
import json
import os
import secrets
from pathlib import Path
from typing import Iterable, Optional

TOKEN_ENV = "BUCKS_AGENT_TOKEN"
TOKEN_FILE_ENV = "BUCKS_AGENT_TOKEN_FILE"

# Requests whose Host header names anything else are refused, which defeats
# DNS rebinding (an attacker domain resolving to 127.0.0.1 still sends its own
# name as Host).
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]"})

# The shell and the Cmd+K window are file:// pages, which Chromium reports as
# the opaque origin "null". No web page can obtain the token, so this is only
# defence in depth on top of the token check.
SHELL_ORIGINS = ["null"]


def token_file() -> Path:
    override = os.environ.get(TOKEN_FILE_ENV)
    return Path(override) if override else Path.home() / ".bucks" / "agent.token"


def _valid(token: Optional[str]) -> bool:
    return bool(token) and len(token) >= 32 and token.isascii() and token.isprintable() and " " not in token


def _read(path: Path) -> Optional[str]:
    try:
        token = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return token if _valid(token) else None


def load_or_create_token() -> str:
    """Return the shared token: env first, then the token file, else mint one."""
    env_token = os.environ.get(TOKEN_ENV, "").strip()
    if _valid(env_token):
        return env_token

    path = token_file()
    existing = _read(path)
    if existing:
        return existing

    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    try:
        # O_EXCL: if Electron (or a second engine) creates the file at the same
        # moment, exactly one write wins and everyone reads that one back.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        existing = _read(path)
        if existing:
            return existing
        raise RuntimeError(f"{path} exists but does not hold a valid agent token")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(token + "\n")
    return token


def _header(scope: dict, name: bytes) -> Optional[str]:
    for key, value in scope.get("headers") or []:
        if key == name:
            return value.decode("latin-1")
    return None


def _host_allowed(host_header: Optional[str]) -> bool:
    if not host_header:
        return False
    host = host_header.strip().lower()
    if host.startswith("["):  # IPv6 literal, possibly with a port
        host = host.split("]", 1)[0] + "]"
    else:
        host = host.rsplit(":", 1)[0]
    return host in LOOPBACK_HOSTS


def _presented_token(scope: dict) -> Optional[str]:
    auth = _header(scope, b"authorization")
    if auth and auth[:7].lower() == "bearer ":
        return auth[7:].strip()
    if scope["type"] == "websocket":
        # Browsers cannot set headers on a WebSocket handshake, so a socket
        # may present the token as ?token=… instead.
        from urllib.parse import parse_qs

        query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
        values = query.get("token")
        if values:
            return values[0]
    return None


class LocalAuthMiddleware:
    """Pure ASGI middleware, so streamed (SSE) responses pass through untouched."""

    def __init__(self, app, token: str, public_paths: Iterable[str] = ("/health",)):
        self.app = app
        self._token = token.encode("utf-8")
        self._public = frozenset(public_paths)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        if not _host_allowed(_header(scope, b"host")):
            await self._reject(scope, receive, send, 403, "Host not allowed")
            return

        # CORS preflights carry no credentials; CORSMiddleware sits outside
        # this one and answers them, so only plain OPTIONS ever reach here.
        if scope["type"] == "http" and scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return

        if scope.get("path") in self._public:
            await self.app(scope, receive, send)
            return

        presented = _presented_token(scope)
        if presented is None or not hmac.compare_digest(presented.encode("utf-8"), self._token):
            await self._reject(scope, receive, send, 401, "Missing or invalid agent token")
            return

        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(scope, receive, send, status: int, detail: str):
        if scope["type"] == "websocket":
            await receive()  # websocket.connect
            await send({"type": "websocket.close", "code": 4401 if status == 401 else 4403})
            return
        body = json.dumps({"detail": detail}).encode("utf-8")
        headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
        if status == 401:
            headers.append((b"www-authenticate", b"Bearer"))
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})


def protect(app, *, expose_headers: Iterable[str] = ()) -> str:
    """Install token auth plus shell-only CORS on a FastAPI app; returns the token.

    Call this instead of adding CORSMiddleware yourself. Auth is added first so
    that CORS ends up outermost: preflights are answered without credentials,
    and 401s still carry CORS headers for the shell to read.
    """
    from fastapi.middleware.cors import CORSMiddleware

    token = load_or_create_token()
    app.add_middleware(LocalAuthMiddleware, token=token)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=SHELL_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
        expose_headers=list(expose_headers),
    )
    return token
